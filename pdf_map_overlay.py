def extract_gdal_bounds(pdf_path):
	try:
		from osgeo import gdal, osr
		ds = gdal.Open(pdf_path)
		gt = ds.GetGeoTransform()
		if gt:
			width = ds.RasterXSize
			height = ds.RasterYSize
			minx = gt[0]
			maxy = gt[3]
			maxx = minx + width * gt[1]
			miny = maxy + height * gt[5]
			# Get projection
			proj = ds.GetProjection()
			srs = osr.SpatialReference()
			srs.ImportFromWkt(proj)
			# Target WGS84
			tgt = osr.SpatialReference()
			tgt.ImportFromEPSG(4326)
			transform = osr.CoordinateTransformation(srs, tgt)
			# Transform SW and NE corners
			sw_lonlat = transform.TransformPoint(minx, miny)
			ne_lonlat = transform.TransformPoint(maxx, maxy)
			# sw_lonlat and ne_lonlat are (lon, lat, z)
			return [sw_lonlat[1], sw_lonlat[0], ne_lonlat[1], ne_lonlat[0]]
	except Exception as e:
		print("GDAL reprojection error:", e)
		pass
	return None
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
	bounds = extract_gdal_bounds(pdf_path)
	if bounds:
		return bounds
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
