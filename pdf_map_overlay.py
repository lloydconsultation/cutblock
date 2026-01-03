def extract_gdal_metadata(pdf_path):
	"""Try to extract GeoPDF-style georeferencing via GDAL.

	Returns a dict with:
	- available: bool (was GDAL usable)
	- has_georef: bool
	- projection_wkt: str|None
	- geotransform: tuple|None
	- gcp_count: int
	- raster_size: (width,height)|None
	- bounds_wgs84: [sw_lat, sw_lng, ne_lat, ne_lng]|None
	"""
	meta = {
		"available": False,
		"has_georef": False,
		"projection_wkt": None,
		"geotransform": None,
		"gcp_count": 0,
		"raster_size": None,
		"bounds_wgs84": None,
		"error": None,
	}
	try:
		from osgeo import gdal, osr
		meta["available"] = True
		ds = gdal.Open(pdf_path)
		if ds is None:
			meta["error"] = "GDAL could not open PDF"
			return meta

		width = getattr(ds, "RasterXSize", None)
		height = getattr(ds, "RasterYSize", None)
		if width is not None and height is not None:
			meta["raster_size"] = (int(width), int(height))

		proj = ds.GetProjection() or None
		meta["projection_wkt"] = proj

		gcps = ds.GetGCPs() or []
		meta["gcp_count"] = len(gcps)

		gt = ds.GetGeoTransform(can_return_null=True)
		meta["geotransform"] = gt

		if proj or gt or meta["gcp_count"]:
			meta["has_georef"] = True

		# Prefer geotransform bounds if present
		if gt and width and height:
			minx = gt[0]
			maxy = gt[3]
			maxx = minx + width * gt[1]
			miny = maxy + height * gt[5]

			if proj:
				srs = osr.SpatialReference()
				srs.ImportFromWkt(proj)
				tgt = osr.SpatialReference()
				tgt.ImportFromEPSG(4326)
				transform = osr.CoordinateTransformation(srs, tgt)
				sw_lonlat = transform.TransformPoint(minx, miny)
				ne_lonlat = transform.TransformPoint(maxx, maxy)
				meta["bounds_wgs84"] = [sw_lonlat[1], sw_lonlat[0], ne_lonlat[1], ne_lonlat[0]]
		return meta
	except Exception as e:
		meta["error"] = str(e)
		return meta
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
import shutil
import os
from pdf2image import convert_from_bytes
import fitz  # PyMuPDF

app = FastAPI()

UPLOAD_DIR = "static/pdf_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def extract_geospatial_bounds(pdf_path):
	# Try GDAL first
	gdal_meta = extract_gdal_metadata(pdf_path)
	if gdal_meta.get("bounds_wgs84"):
		return gdal_meta["bounds_wgs84"]
	# Fallback to PyMuPDF method
	doc = fitz.open(pdf_path)
	page = doc[0]
	xref = page.xref
	pdf_dict = doc.xref_object(xref, compressed=False)
	import re
	measure_match = re.search(r'/Measure\s+(\d+)', pdf_dict)
	if measure_match:
		measure_xref = int(measure_match.group(1))
		measure_dict = doc.xref_object(measure_xref, compressed=False)
		gpts_match = re.search(r'/GPTS\s*\[(.*?)\]', measure_dict)
		if gpts_match:
			gpts = [float(x) for x in gpts_match.group(1).split()]
			return [gpts[1], gpts[0], gpts[3], gpts[2]]
	return None


def extract_pymupdf_measure_metadata(pdf_path):
	"""Best-effort check for PDF /Measure /GPTS metadata via PyMuPDF."""
	meta = {
		"available": True,
		"has_measure": False,
		"gpts": None,
		"error": None,
	}
	try:
		doc = fitz.open(pdf_path)
		page = doc[0]
		xref = page.xref
		pdf_dict = doc.xref_object(xref, compressed=False)
		import re
		measure_match = re.search(r"/Measure\s+(\d+)", pdf_dict)
		if not measure_match:
			return meta
		measure_xref = int(measure_match.group(1))
		measure_dict = doc.xref_object(measure_xref, compressed=False)
		gpts_match = re.search(r"/GPTS\s*\[(.*?)\]", measure_dict)
		if not gpts_match:
			return meta
		gpts = [float(x) for x in gpts_match.group(1).split()]
		if len(gpts) >= 4:
			meta["has_measure"] = True
			meta["gpts"] = gpts[:4]
		return meta
	except Exception as e:
		meta["available"] = False
		meta["error"] = str(e)
		return meta

@app.post("/upload-pdf-map")
async def upload_pdf_map(
	file: UploadFile = File(...),
	sw_coord: str = Form(None),
	ne_coord: str = Form(None)
):
	# Save PDF
	pdf_path = os.path.join(UPLOAD_DIR, file.filename)
	with open(pdf_path, "wb") as buffer:
		shutil.copyfileobj(file.file, buffer)

	# Convert first page of PDF to PNG
	images = convert_from_bytes(open(pdf_path, "rb").read())
	img_path = pdf_path + ".png"
	images[0].save(img_path, "PNG")

	# Try to extract geospatial bounds
	bounds = extract_geospatial_bounds(pdf_path)
	if not bounds:
		# Try to use manual coordinates if provided
		if sw_coord and ne_coord:
			try:
				sw = [float(x) for x in sw_coord.split(",")]
				ne = [float(x) for x in ne_coord.split(",")]
				if len(sw) == 2 and len(ne) == 2:
					bounds = [sw[0], sw[1], ne[0], ne[1]]
				else:
					raise ValueError
			except Exception:
				return JSONResponse({"error": "Invalid manual coordinates. Use format: lat,lng for both SW and NE."}, status_code=400)
		else:
			return JSONResponse({
				"error": (
					"No geospatial info found in PDF. "
					"This feature requires a GeoPDF with embedded geospatial metadata (e.g. /Measure and /GPTS tags). "
					"If your PDF is not georeferenced, you must provide coordinates manually."
				)
			}, status_code=400)

	# Debug print for bounds
	print("PDF overlay bounds:", bounds)
	# Return image URL and bounds
	return JSONResponse({
		"image_url": f"/static/pdf_uploads/{os.path.basename(img_path)}",
		"bounds": bounds
	})


@app.post("/inspect-pdf-map")
async def inspect_pdf_map(file: UploadFile = File(...)):
	"""Inspect an uploaded PDF and report whether it contains geospatial metadata."""
	# Save PDF (keep original so GDAL/PyMuPDF can read it)
	pdf_path = os.path.join(UPLOAD_DIR, file.filename)
	with open(pdf_path, "wb") as buffer:
		shutil.copyfileobj(file.file, buffer)

	gdal_meta = extract_gdal_metadata(pdf_path)
	measure_meta = extract_pymupdf_measure_metadata(pdf_path)
	bounds = extract_geospatial_bounds(pdf_path)

	has_georef = bool(bounds) or bool(gdal_meta.get("has_georef")) or bool(measure_meta.get("has_measure"))

	return JSONResponse({
		"filename": file.filename,
		"has_geospatial_metadata": has_georef,
		"bounds_wgs84": bounds,
		"gdal": gdal_meta,
		"pdf_measure": measure_meta,
	})
