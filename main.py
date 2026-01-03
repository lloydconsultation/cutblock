from fastapi import FastAPI, Response, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from map_functionality import initialize_map
from geom_manipulation import (
    kmeans_split_polygon,
    vertical_split_polygon,
    horizontal_split_polygon,
    radial_split_polygon,
)
import uvicorn

# Import PDF overlay FastAPI app and mount its routes
from pdf_map_overlay import app as pdf_app

app = FastAPI()

# Serve static files (index.html)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Mount PDF upload endpoint
for route in pdf_app.routes:
    app.router.routes.append(route)

@app.get("/")
def root():
    return FileResponse("static/index.html")

@app.get("/map", response_class=Response)
def show_map():
    my_map = initialize_map(location=[50.9981, -118.1957], zoom_start=13)
    return Response(content=my_map._repr_html_(), media_type="text/html")

# API endpoint for splitting polygon
@app.post("/split-polygon")
async def split_polygon(request: Request):
    data = await request.json()
    coords = data.get("coords")
    n_clusters = data.get("n_clusters", 2)
    mode = (data.get("mode") or "kmeans").lower()
    if not coords or len(coords) < 3:
        return JSONResponse({"error": "Invalid coordinates"}, status_code=400)
    # Convert to (x, y) tuples
    poly_coords = [(float(x), float(y)) for x, y in coords]

    if mode == "vertical":
        polys = vertical_split_polygon(poly_coords, n_parts=int(n_clusters))
    elif mode == "horizontal":
        polys = horizontal_split_polygon(poly_coords, n_parts=int(n_clusters))
    elif mode == "radial":
        polys = radial_split_polygon(poly_coords, n_parts=int(n_clusters), area_tolerance=0.05)
    else:
        polys = kmeans_split_polygon(poly_coords, n_clusters=n_clusters)
    # Return as list of lists of [lat, lng]
    result = []
    for poly in polys:
        # folium/leaflet expects [lat, lng], shapely uses (x, y)
        coords = [[y, x] for x, y in poly.exterior.coords]
        result.append(coords)
    return {"polygons": result}


