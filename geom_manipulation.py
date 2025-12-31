
import numpy as np
from shapely.geometry import Polygon, Point, MultiPoint
from shapely.ops import voronoi_diagram, polygonize
from sklearn.cluster import KMeans

def kmeans_split_polygon(polygon_coords, n_clusters=2, n_points=1000):
	"""
	Split a polygon into n_clusters smaller polygons using k-means clustering.
	Args:
		polygon_coords: List of (x, y) tuples representing the polygon.
		n_clusters: Number of clusters (sub-polygons) to create.
		n_points: Number of random points to sample inside the polygon for clustering.
	Returns:
		List of shapely Polygon objects representing the split polygons.
	"""
	poly = Polygon(polygon_coords)
	minx, miny, maxx, maxy = poly.bounds
	points = []
	rng = np.random.default_rng()
	# Sample random points inside the polygon
	while len(points) < n_points:
		x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
		if poly.contains(Point(x, y)):
			points.append([x, y])
	points = np.array(points)

	# K-means clustering
	kmeans = KMeans(n_clusters=n_clusters, n_init=10)
	labels = kmeans.fit_predict(points)
	centroids = kmeans.cluster_centers_

	# Create Voronoi diagram from centroids
	vor = voronoi_diagram(MultiPoint([Point(c) for c in centroids]), envelope=poly)
	# Intersect Voronoi cells with the original polygon
	result_polys = []
	for region in vor.geoms:
		clipped = region.intersection(poly)
		if clipped.is_empty:
			continue
		if clipped.type == 'Polygon':
			result_polys.append(clipped)
		elif clipped.type == 'MultiPolygon':
			result_polys.extend(list(clipped.geoms))
	return result_polys
