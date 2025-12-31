
from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from map_functionality import initialize_map

app = FastAPI()

# Serve static files (index.html)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")

@app.get("/map", response_class=Response)
def show_map():
    my_map = initialize_map(location=[50.9981, -118.1957], zoom_start=13)
    return Response(content=my_map._repr_html_(), media_type="text/html")


