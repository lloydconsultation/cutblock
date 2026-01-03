## TODO

- [ ] Fix the 'Revert Division' button so that it reliably restores the previous polygon state after a division. Currently, this feature is broken and does not  restore polygons but deletes all polys

# CutBlock

A web app for drawing polygons on a map, dividing them using k-means clustering, and downloading the results as GeoJSON.

## Requirements

- Python 3.8+
- pip
- (Recommended) Virtual environment

## Setup

1. Clone the repository and navigate to the project folder:

   ```sh
   git clone <your-repo-url>
   cd CutBlock
   ```

2. Create and activate a virtual environment:

   ```sh
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install dependencies:
   ```sh
   pip install -r requirements.txt
   ```
   If you don't have a requirements.txt, install manually:
   ```sh
   pip install fastapi uvicorn folium shapely scikit-learn numpy
   ```

## Running the Server

Start the FastAPI server with:

```sh
uvicorn main:app --reload
```

Or, if you have the FastAPI CLI:

```sh
fastapi dev main.py
```

## Usage

- Open your browser and go to: [http://localhost:8000/](http://localhost:8000/)
- Draw a polygon on the map.
- Click "Divide Polygon (K-means)" to split it into smaller polygons.
- Click "Download GeoJSON" to save your drawn shapes.

## Notes

- The .venv directory