import numpy as np
from shapely.geometry import Polygon, Point, MultiPoint, box
from shapely.ops import voronoi_diagram, unary_union
from sklearn.cluster import KMeans


def _largest_polygon(geom):
	if geom is None or geom.is_empty:
		return None
	if geom.geom_type == "Polygon":
		return geom
	if geom.geom_type == "MultiPolygon":
		polys = list(geom.geoms)
		return max(polys, key=lambda p: p.area) if polys else None
	try:
		fixed = geom.buffer(0)
		return _largest_polygon(fixed)
	except Exception:
		return None



def _sample_points_in_polygon(poly, n_points, rng):
	minx, miny, maxx, maxy = poly.bounds
	points = []
	# Sample random points inside the polygon
	while len(points) < n_points:
		x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
		if poly.contains(Point(x, y)):
			points.append([x, y])
	return np.array(points)


def _capacities_equal(total_points, n_clusters):
	base = total_points // n_clusters
	extra = total_points % n_clusters
	return [base + (1 if i < extra else 0) for i in range(n_clusters)]


def _assign_with_capacities(points, centroids, capacities):
	"""Assign each point to a centroid while respecting per-centroid capacities."""
	points = np.asarray(points)
	centroids = np.asarray(centroids)
	n, k = points.shape[0], centroids.shape[0]
	# Distances: (n, k)
	dists = np.linalg.norm(points[:, None, :] - centroids[None, :, :], axis=2)
	prefs = np.argsort(dists, axis=1)
	# Regret: how much worse 2nd best is than best; assign high-regret points first
	best = dists[np.arange(n), prefs[:, 0]]
	second = dists[np.arange(n), prefs[:, 1]] if k > 1 else best
	regret = second - best
	order = np.argsort(-regret)

	remaining = capacities[:]
	assignments = -np.ones(n, dtype=int)
	for idx in order:
		for c in prefs[idx]:
			if remaining[c] > 0:
				assignments[idx] = c
				remaining[c] -= 1
				break
		if assignments[idx] == -1:
			# Shouldn't happen, but as a fallback dump into nearest
			assignments[idx] = int(prefs[idx, 0])

	return assignments


def _balanced_kmeans(points, n_clusters, n_iter=8, rng=None):
	"""Heuristic balanced k-means: iteratively enforce equal point counts per cluster."""
	if rng is None:
		rng = np.random.default_rng()

	# Start from regular kmeans centroids
	kmeans = KMeans(n_clusters=n_clusters, n_init=5, random_state=int(rng.integers(0, 1_000_000)))
	labels = kmeans.fit_predict(points)
	centroids = kmeans.cluster_centers_

	capacities = _capacities_equal(points.shape[0], n_clusters)

	for _ in range(n_iter):
		labels = _assign_with_capacities(points, centroids, capacities)
		new_centroids = []
		for c in range(n_clusters):
			cluster_pts = points[labels == c]
			if len(cluster_pts) == 0:
				new_centroids.append(centroids[c])
			else:
				new_centroids.append(cluster_pts.mean(axis=0))
		new_centroids = np.array(new_centroids)
		if np.allclose(new_centroids, centroids):
			break
		centroids = new_centroids

	return centroids


def _voronoi_split_from_centroids(poly, centroids, keep_largest_piece=True):
	vor = voronoi_diagram(MultiPoint([Point(c) for c in centroids]), envelope=poly)
	result_polys = []
	for region in vor.geoms:
		clipped = region.intersection(poly)
		if clipped.is_empty:
			continue
		if clipped.geom_type == "Polygon":
			result_polys.append(clipped)
		elif clipped.geom_type == "MultiPolygon":
			if keep_largest_piece:
				largest = _largest_polygon(clipped)
				if largest is not None:
					result_polys.append(largest)
			else:
				result_polys.extend(list(clipped.geoms))
	return result_polys


def equal_area_kmeans_split_polygon(
	polygon_coords,
	n_clusters,
	n_points=2000,
	area_tolerance=0.05,
	restarts=6,
):
	"""Attempt near-equal-area split using balanced k-means + Voronoi.

	We enforce (approximately) equal *point counts* per cluster on uniformly-sampled
	interior points, which usually produces near-equal areas without axis-aligned cuts.
	"""
	poly = Polygon(polygon_coords).buffer(0)
	if poly.is_empty:
		return []
	if n_clusters <= 1:
		return [poly]

	rng = np.random.default_rng()
	points = _sample_points_in_polygon(poly, n_points, rng)

	best_polys = None
	best_dev = float("inf")
	target = poly.area / float(n_clusters) if poly.area > 0 else None

	for _ in range(restarts):
		centroids = _balanced_kmeans(points, n_clusters, n_iter=8, rng=rng)
		polys = _voronoi_split_from_centroids(poly, centroids, keep_largest_piece=True)
		# Ensure we got the requested number of pieces
		if len(polys) != n_clusters:
			continue
		if target is None or target <= 0:
			return polys
		dev = max(abs(p.area - target) / target for p in polys)
		if dev < best_dev:
			best_dev = dev
			best_polys = polys
		if dev <= area_tolerance:
			return polys

	return best_polys if best_polys is not None else []


def kmeans_split_polygon(
	polygon_coords,
	n_clusters=2,
	n_points=1000,
	ensure_equal_area=True,
	area_tolerance=0.05,
):
	"""
	Split a polygon into n_clusters smaller polygons using k-means clustering.
	Args:
		polygon_coords: List of (x, y) tuples representing the polygon.
		n_clusters: Number of clusters (sub-polygons) to create.
		n_points: Number of random points to sample inside the polygon for clustering.
	Returns:
		List of shapely Polygon objects representing the split polygons.
	"""
	poly = Polygon(polygon_coords).buffer(0)
	if ensure_equal_area:
		parts = equal_area_kmeans_split_polygon(
			polygon_coords,
			int(n_clusters),
			n_points=max(int(n_points), 2000),
			area_tolerance=area_tolerance,
			restarts=6,
		)
		if parts and len(parts) == int(n_clusters):
			return parts
		# If we couldn't reach tolerance, fall back to classic kmeans/voronoi.

	points = _sample_points_in_polygon(poly, n_points, np.random.default_rng())

	# K-means clustering
	kmeans = KMeans(n_clusters=n_clusters, n_init=10)
	labels = kmeans.fit_predict(points)
	centroids = kmeans.cluster_centers_

	# Create Voronoi diagram from centroids
	return _voronoi_split_from_centroids(poly, centroids, keep_largest_piece=False)


def _find_axis_cut_for_target_area(geom, axis, target_area, max_iter=60):
	"""Binary search a vertical/horizontal cut that yields target_area on the low side."""
	geom = geom.buffer(0)
	if geom.is_empty:
		return None

	minx, miny, maxx, maxy = geom.bounds
	span = max(maxx - minx, maxy - miny)
	pad = span * 0.01 + 1e-9

	lo = minx if axis == "x" else miny
	hi = maxx if axis == "x" else maxy

	# Clamp target
	target_area = float(target_area)
	if target_area <= 0:
		return lo
	if target_area >= geom.area:
		return hi

	best = None
	best_err = float("inf")

	for _ in range(max_iter):
		mid = (lo + hi) / 2.0
		if axis == "x":
			low_box = box(minx - pad, miny - pad, mid, maxy + pad)
		else:
			low_box = box(minx - pad, miny - pad, maxx + pad, mid)
		low_geom = geom.intersection(low_box)
		low_area = low_geom.area
		err = abs(low_area - target_area)
		if err < best_err:
			best_err = err
			best = mid
		if low_area < target_area:
			lo = mid
		else:
			hi = mid

	return best if best is not None else (lo + hi) / 2.0


def _axis_equal_area_split(polygon_coords, n_parts, axis):
	"""Split polygon into n_parts using axis-aligned cuts (vertical or horizontal).

	This intentionally produces straight cut lines. It targets equal area per piece.
	"""
	poly = Polygon(polygon_coords).buffer(0)
	if poly.is_empty:
		return []
	if n_parts <= 1:
		return [poly]

	remaining = poly
	parts = []

	for i in range(int(n_parts) - 1):
		remaining_parts = int(n_parts) - i
		if remaining.is_empty or remaining_parts <= 1:
			break
		target = remaining.area / float(remaining_parts)
		cut_val = _find_axis_cut_for_target_area(remaining, axis, target)
		if cut_val is None:
			break

		minx, miny, maxx, maxy = remaining.bounds
		span = max(maxx - minx, maxy - miny)
		pad = span * 0.01 + 1e-9
		if axis == "x":
			low_box = box(minx - pad, miny - pad, cut_val, maxy + pad)
		else:
			low_box = box(minx - pad, miny - pad, maxx + pad, cut_val)

		low_geom = remaining.intersection(low_box).buffer(0)
		high_geom = remaining.difference(low_box).buffer(0)
		if low_geom.is_empty or high_geom.is_empty:
			break

		low_poly = _largest_polygon(low_geom)
		if low_poly is None or low_poly.is_empty:
			break

		# Preserve total area: move any extra fragments on the low side into the remainder
		if low_geom.geom_type == "MultiPolygon":
			extras = low_geom.difference(low_poly)
			if extras is not None and not extras.is_empty:
				high_geom = unary_union([high_geom, extras]).buffer(0)

		parts.append(low_poly)
		remaining = high_geom

	final_poly = _largest_polygon(remaining)
	if final_poly is not None and not final_poly.is_empty:
		parts.append(final_poly)

	# Best effort to return exactly n_parts
	return parts[: int(n_parts)]


def vertical_split_polygon(polygon_coords, n_parts):
	"""Vertical split (cuts along longitude/x)."""
	return _axis_equal_area_split(polygon_coords, n_parts, axis="x")


def horizontal_split_polygon(polygon_coords, n_parts):
	"""Horizontal split (cuts along latitude/y)."""
	return _axis_equal_area_split(polygon_coords, n_parts, axis="y")

