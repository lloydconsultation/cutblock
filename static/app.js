(function () {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function deselectAll(drawnItems) {
    drawnItems.eachLayer(function (layer) {
      layer.setStyle && layer.setStyle({ color: "#3388ff", weight: 3 });
      if (layer.closePopup) layer.closePopup();
    });
  }

  function getPolygonPathFromName(name) {
    if (!name || typeof name !== "string") return null;
    var trimmed = name.trim();
    var match = trimmed.match(/^Polygon\s+(.+)$/i);
    return (match ? match[1] : trimmed).trim() || null;
  }

  function makeChildPolygonName(parentName, index) {
    var parentPath = getPolygonPathFromName(parentName);
    if (!parentPath) parentPath = "";
    if (parentPath.length > 0) {
      return "Polygon " + parentPath + "." + index;
    }
    return "Polygon " + index;
  }

  function bindPolygonInteractions(state, layer) {
    layer.on("click", function () {
      deselectAll(state.drawnItems);
      layer.setStyle && layer.setStyle({ color: "red", weight: 5 });
      state.selectedPolygon = layer;
      window.selectedPolygon = layer; // backwards-compatible

      var geojson = layer.toGeoJSON();
      var area = null;
      try {
        if (
          geojson &&
          geojson.geometry &&
          (geojson.geometry.type === "Polygon" ||
            geojson.geometry.type === "MultiPolygon")
        ) {
          area = turf.area(geojson);
        }
      } catch (e) {
        area = null;
      }

      var name =
        geojson.properties && geojson.properties.name
          ? geojson.properties.name
          : "Polygon";
      var areaText =
        area === null
          ? "N/A"
          : area.toLocaleString(undefined, { maximumFractionDigits: 2 });

      var popupContent = `<b>${name}</b><br>Area: ${areaText} m²`;
      if (layer.getPopup && layer.getPopup()) {
        layer.setPopupContent(popupContent);
        layer.openPopup();
      } else if (layer.bindPopup) {
        layer.bindPopup(popupContent).openPopup();
      }
    });
  }

  function normalizeLatLngs(latlngs) {
    if (!Array.isArray(latlngs)) {
      if (
        latlngs &&
        typeof latlngs.lat === "number" &&
        typeof latlngs.lng === "number"
      ) {
        return [latlngs.lat, latlngs.lng];
      }
      return latlngs;
    }
    return latlngs.map(normalizeLatLngs);
  }

  function snapshotDrawnItems(drawnItems) {
    var snapshot = [];
    drawnItems.eachLayer(function (layer) {
      if (!layer || !layer.getLatLngs) return;
      var latlngs = normalizeLatLngs(layer.getLatLngs());
      var props =
        layer.feature && layer.feature.properties
          ? JSON.parse(JSON.stringify(layer.feature.properties))
          : {};
      snapshot.push({ latlngs: latlngs, properties: props });
    });
    return snapshot;
  }

  function restoreFromSnapshot(snapshot) {
    var restoredLayers = [];
    var maxPolyNum = 0;

    (snapshot || []).forEach(function (item) {
      if (!item || !item.latlngs) return;
      var layer = L.polygon(item.latlngs);
      layer.feature = {
        type: "Feature",
        properties: item.properties || {},
      };
      restoredLayers.push(layer);

      if (layer.feature.properties && layer.feature.properties.name) {
        var match = layer.feature.properties.name.match(/Polygon (\d+)/);
        if (match) {
          var num = parseInt(match[1]);
          if (num > maxPolyNum) maxPolyNum = num;
        }
      }
    });

    return { layers: restoredLayers, maxPolyNum: maxPolyNum };
  }

  function initPdfOverlay(state) {
    var pdfForm = byId("pdf-upload-form");
    var toggleBtn = byId("toggle-pdf");
    var opacitySlider = byId("pdf-opacity");
    var opacityLabel = byId("opacity-label");
    var pdfControls = byId("pdf-controls");

    var nudgeStep = 0.0001;
    var scaleStep = 0.01;

    function updateOverlay(bounds) {
      if (!state.pdfOverlay) return;
      state.map.removeLayer(state.pdfOverlay);
      state.pdfOverlay = L.imageOverlay(state.pdfOverlay._url, bounds, {
        opacity: parseFloat(opacitySlider.value),
      }).addTo(state.map);
    }

    function getCurrentBounds() {
      if (!state.pdfOverlay) return null;
      var b = state.pdfOverlay.getBounds();
      return [
        [b.getSouthWest().lat, b.getSouthWest().lng],
        [b.getNorthEast().lat, b.getNorthEast().lng],
      ];
    }

    toggleBtn.onclick = function () {
      if (!state.pdfOverlay) return;
      if (state.map.hasLayer(state.pdfOverlay)) {
        state.map.removeLayer(state.pdfOverlay);
        toggleBtn.textContent = "Show PDF Overlay";
        opacityLabel.style.display = "none";
      } else {
        state.map.addLayer(state.pdfOverlay);
        toggleBtn.textContent = "Hide PDF Overlay";
        opacityLabel.style.display = "inline-flex";
      }
    };

    opacitySlider.oninput = function () {
      if (state.pdfOverlay) {
        state.pdfOverlay.setOpacity(parseFloat(opacitySlider.value));
      }
    };

    byId("nudge-up").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      updateOverlay([
        [b[0][0] + nudgeStep, b[0][1]],
        [b[1][0] + nudgeStep, b[1][1]],
      ]);
    };
    byId("nudge-down").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      updateOverlay([
        [b[0][0] - nudgeStep, b[0][1]],
        [b[1][0] - nudgeStep, b[1][1]],
      ]);
    };
    byId("nudge-left").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      updateOverlay([
        [b[0][0], b[0][1] - nudgeStep],
        [b[1][0], b[1][1] - nudgeStep],
      ]);
    };
    byId("nudge-right").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      updateOverlay([
        [b[0][0], b[0][1] + nudgeStep],
        [b[1][0], b[1][1] + nudgeStep],
      ]);
    };

    byId("scale-up").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      var center = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
      var latHalf = ((b[1][0] - b[0][0]) / 2) * (1 + scaleStep);
      var lngHalf = ((b[1][1] - b[0][1]) / 2) * (1 + scaleStep);
      updateOverlay([
        [center[0] - latHalf, center[1] - lngHalf],
        [center[0] + latHalf, center[1] + lngHalf],
      ]);
    };

    byId("scale-down").onclick = function () {
      var b = getCurrentBounds();
      if (!b) return;
      var center = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
      var latHalf = ((b[1][0] - b[0][0]) / 2) * (1 - scaleStep);
      var lngHalf = ((b[1][1] - b[0][1]) / 2) * (1 - scaleStep);
      updateOverlay([
        [center[0] - latHalf, center[1] - lngHalf],
        [center[0] + latHalf, center[1] + lngHalf],
      ]);
    };

    pdfForm.onsubmit = async function (e) {
      e.preventDefault();
      var fileInput = byId("pdf-file");
      var swInput = byId("sw-coord");
      var neInput = byId("ne-coord");

      if (!fileInput.files.length) {
        alert("Please select a PDF.");
        pdfControls.style.display = "inline-flex";
        return;
      }

      var formData = new FormData();
      formData.append("file", fileInput.files[0]);
      formData.append("sw_coord", swInput.value);
      formData.append("ne_coord", neInput.value);

      var resp = await fetch("/upload-pdf-map", {
        method: "POST",
        body: formData,
      });

      var data;
      try {
        data = await resp.json();
      } catch (err) {
        var text = await resp.text();
        alert(text || "Upload failed");
        return;
      }

      if (
        !resp.ok &&
        data &&
        data.error &&
        data.error.includes("No geospatial info")
      ) {
        var sw = swInput.value.split(",").map(Number);
        var ne = neInput.value.split(",").map(Number);
        if (
          sw.length !== 2 ||
          ne.length !== 2 ||
          sw.some(isNaN) ||
          ne.some(isNaN)
        ) {
          alert(
            "No geospatial info found in PDF. Please enter SW and NE coordinates as lat,lng."
          );
          return;
        }

        if (state.pdfOverlay) state.map.removeLayer(state.pdfOverlay);

        var imgPath = fileInput.files[0].name + ".png";
        var imageUrl = "/static/pdf_uploads/" + imgPath;
        var manualBounds = [sw, ne];

        state.pdfOverlay = L.imageOverlay(imageUrl, manualBounds, {
          opacity: parseFloat(opacitySlider.value),
        }).addTo(state.map);

        state.map.fitBounds(manualBounds);
        toggleBtn.style.display = "inline-block";
        toggleBtn.textContent = "Hide PDF Overlay";
        opacityLabel.style.display = "inline-flex";
        return;
      }

      if (!resp.ok || data.error) {
        alert(data.error || "Upload failed");
        return;
      }

      if (state.pdfOverlay) state.map.removeLayer(state.pdfOverlay);

      var bounds = [
        [data.bounds[0], data.bounds[1]],
        [data.bounds[2], data.bounds[3]],
      ];

      if (Math.abs(bounds[0][0]) > 90 || Math.abs(bounds[1][0]) > 90) {
        bounds = [
          [data.bounds[1], data.bounds[0]],
          [data.bounds[3], data.bounds[2]],
        ];
      }

      state.pdfOverlay = L.imageOverlay(data.image_url, bounds, {
        opacity: parseFloat(opacitySlider.value),
      }).addTo(state.map);

      state.map.fitBounds(bounds);
      toggleBtn.style.display = "inline-block";
      toggleBtn.textContent = "Hide PDF Overlay";
      opacityLabel.style.display = "inline-flex";
      pdfControls.style.display = "inline-flex";
    };
  }

  function init() {
    var state = {
      map: null,
      drawnItems: null,
      selectedPolygon: null,
      pdfOverlay: null,
    };

    // Basemap layers
    var osm = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }
    );

    var satellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution:
          "Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      }
    );

    var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution:
        "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
    });

    var carto = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    );

    state.map = L.map("map", {
      center: [50.9981, -118.1957],
      zoom: 13,
      layers: [osm],
    });

    var baseMaps = {
      OpenStreetMap: osm,
      Satellite: satellite,
      Topo: topo,
      "Carto Light": carto,
    };

    L.control
      .layers(baseMaps, null, { position: "topright", collapsed: false })
      .addTo(state.map);

    state.drawnItems = new L.FeatureGroup();
    state.map.addLayer(state.drawnItems);

    var drawControl = new L.Control.Draw({
      edit: { featureGroup: state.drawnItems },
      draw: {
        polygon: true,
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    });
    state.map.addControl(drawControl);

    if (!window.polygonHistory) window.polygonHistory = [];

    state.map.on(L.Draw.Event.CREATED, function (e) {
      var layer = e.layer;
      state.drawnItems.addLayer(layer);

      if (!window.polygonNameCounter) window.polygonNameCounter = 1;
      layer.feature = layer.feature || { type: "Feature", properties: {} };
      layer.feature.properties.name = "Polygon " + window.polygonNameCounter++;

      bindPolygonInteractions(state, layer);
    });

    byId("download").onclick = function () {
      var data = state.drawnItems.toGeoJSON();
      var blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "drawn_polygons.geojson";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    byId("revert-poly").onclick = function () {
      if (!window.polygonHistory || window.polygonHistory.length === 0) {
        alert("No previous state to revert to.");
        return;
      }

      var snapshot = window.polygonHistory[window.polygonHistory.length - 1];
      if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
        alert("No polygons to restore.");
        return;
      }

      try {
        var restored = restoreFromSnapshot(snapshot);
        if (!restored.layers.length) {
          alert("No polygons to restore.");
          return;
        }

        state.drawnItems.clearLayers();
        restored.layers.forEach(function (layer) {
          state.drawnItems.addLayer(layer);
          bindPolygonInteractions(state, layer);
        });

        window.polygonHistory.pop();
        state.selectedPolygon = null;
        window.selectedPolygon = null;
        window.polygonNameCounter = Math.max(restored.maxPolyNum + 1, 1);
      } catch (err) {
        console.error("Revert failed:", err);
        alert("Revert failed. See console for details.");
      }
    };

    byId("split-poly").onclick = async function () {
      var selected = state.selectedPolygon || window.selectedPolygon;
      if (!selected) {
        alert("Please select a polygon to divide.");
        return;
      }

      var selectedGeoJSON = selected.toGeoJSON();
      var parentName =
        (selectedGeoJSON && selectedGeoJSON.properties
          ? selectedGeoJSON.properties.name
          : null) ||
        (selected.feature && selected.feature.properties
          ? selected.feature.properties.name
          : null);

      var coords = selectedGeoJSON.geometry.coordinates[0];

      var nClusters = parseInt(byId("division-number").value);
      if (isNaN(nClusters) || nClusters < 1) {
        alert("Please enter a valid number of divisions.");
        return;
      }

      var methodEl = byId("division-method");
      var mode = methodEl && methodEl.value ? methodEl.value : "kmeans";

      var snapshot = snapshotDrawnItems(state.drawnItems);
      if ((!snapshot || snapshot.length === 0) && selected) {
        snapshot = [
          {
            latlngs: normalizeLatLngs(selected.getLatLngs()),
            properties:
              selected.feature && selected.feature.properties
                ? JSON.parse(JSON.stringify(selected.feature.properties))
                : {},
          },
        ];
      }

      if (!snapshot || snapshot.length === 0) {
        alert("Nothing to snapshot for revert.");
        return;
      }

      window.polygonHistory.push(snapshot);

      var response;
      try {
        response = await fetch("/split-polygon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coords: coords,
            n_clusters: nClusters,
            mode: mode,
          }),
        });
      } catch (err) {
        window.polygonHistory.pop();
        alert("Network error calling split endpoint");
        return;
      }

      if (!response.ok) {
        window.polygonHistory.pop();
        alert("Error from backend");
        return;
      }

      var result = await response.json();

      state.drawnItems.removeLayer(selected);
      state.selectedPolygon = null;
      window.selectedPolygon = null;

      (result.polygons || []).forEach(function (poly, idx) {
        var polygonLayer = L.polygon(poly).addTo(state.drawnItems);
        polygonLayer.feature = {
          type: "Feature",
          properties: {
            name: makeChildPolygonName(parentName, idx + 1),
          },
        };
        bindPolygonInteractions(state, polygonLayer);
      });
    };

    initPdfOverlay(state);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
