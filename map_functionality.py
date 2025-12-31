import folium
from folium.plugins import Draw

def initialize_map(location=[0, 0], zoom_start=2):
    m = folium.Map(location=location, zoom_start=zoom_start)
    Draw(export=True).add_to(m)
    return m
