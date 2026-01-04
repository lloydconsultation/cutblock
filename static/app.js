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

    var loadingOverlay = byId("loading-overlay");
    var loadingText = byId("loading-text");
    var loadingCount = 0;

    function showLoading(message) {
      loadingCount++;
      if (loadingText) {
        loadingText.textContent = message || "Working…";
      }
      if (loadingOverlay) {
        loadingOverlay.style.display = "flex";
        loadingOverlay.setAttribute("aria-hidden", "false");
      }
    }

    function hideLoading() {
      loadingCount = Math.max(0, loadingCount - 1);
      if (loadingCount !== 0) return;
      if (loadingOverlay) {
        loadingOverlay.style.display = "none";
        loadingOverlay.setAttribute("aria-hidden", "true");
      }
    }

    function setPdfControlsEnabled(enabled) {
      var disabled = !enabled;

      if (toggleBtn) toggleBtn.disabled = disabled;
      if (opacitySlider) opacitySlider.disabled = disabled;

      [
        "nudge-up",
        "nudge-down",
        "nudge-left",
        "nudge-right",
        "scale-up",
        "scale-down",
      ].forEach(function (id) {
        var el = byId(id);
        if (el) el.disabled = disabled;
      });

      if (toggleBtn && toggleBtn.classList) {
        toggleBtn.classList.toggle("pdf-ui-disabled", disabled);
      }
      if (opacityLabel && opacityLabel.classList) {
        opacityLabel.classList.toggle("pdf-ui-disabled", disabled);
      }
      if (pdfControls && pdfControls.classList) {
        pdfControls.classList.toggle("pdf-ui-disabled", disabled);
      }
    }

    // Always show controls, but disable until an overlay exists.
    setPdfControlsEnabled(!!state.pdfOverlay);
    if (toggleBtn && !state.pdfOverlay) {
      toggleBtn.textContent = "Toggle PDF Overlay";
    }

    var inspectBtn = byId("inspect-pdf");
    if (inspectBtn) {
      inspectBtn.onclick = async function () {
        var fileInput = byId("pdf-file");
        var swInput = byId("sw-coord");
        var neInput = byId("ne-coord");
        if (!fileInput || !fileInput.files || !fileInput.files.length) {
          alert("Please select a PDF first.");
          return;
        }
        showLoading("Checking PDF metadata…");
        try {
          var formData = new FormData();
          formData.append("file", fileInput.files[0]);
          var resp = await fetch("/inspect-pdf-map", {
            method: "POST",
            body: formData,
          });
          var data;
          try {
            data = await resp.json();
          } catch (e) {
            alert("Metadata check failed.");
            return;
          }

          if (!resp.ok || (data && data.error)) {
            alert((data && data.error) || "Metadata check failed");
            return;
          }

          var has = !!data.has_geospatial_metadata;
          var bounds = data.bounds_wgs84;
          var gdal = data.gdal || {};
          var measure = data.pdf_measure || {};

          // If we have bounds, auto-fill the manual SW/NE fields so the user can
          // upload/place immediately (and it also helps as a fallback).
          var hasBounds = bounds && bounds.length === 4;
          if (hasBounds && swInput && neInput) {
            swInput.value = bounds[0].toFixed(6) + "," + bounds[1].toFixed(6);
            neInput.value = bounds[2].toFixed(6) + "," + bounds[3].toFixed(6);
          }

          var lines = [];
          lines.push("Geo metadata: " + (has ? "FOUND" : "NOT FOUND"));
          if (bounds && bounds.length === 4) {
            lines.push(
              "Bounds (WGS84): SW " +
                bounds[0].toFixed(6) +
                "," +
                bounds[1].toFixed(6) +
                " | NE " +
                bounds[2].toFixed(6) +
                "," +
                bounds[3].toFixed(6)
            );
          }
          lines.push(
            "GDAL available: " +
              (gdal.available ? "yes" : "no") +
              " | has georef: " +
              (gdal.has_georef ? "yes" : "no") +
              " | GCPs: " +
              (gdal.gcp_count || 0)
          );
          lines.push(
            "PDF /Measure GPTS: " + (measure.has_measure ? "yes" : "no")
          );
          if (!has) {
            lines.push(
              "If this is not a GeoPDF, use Center lat,lng + Scale/Move to fit, or provide SW/NE."
            );
          }

          // Offer a one-click path: if bounds exist, we can immediately upload and
          // place the overlay using the existing upload handler.
          if (hasBounds) {
            var doPlace = confirm(
              lines.join("\n") +
                "\n\nBounds were detected and SW/NE were filled.\nUpload + place the overlay now?"
            );
            if (doPlace) {
              // Trigger the existing form submit handler.
              pdfForm.requestSubmit();
              return;
            }
          }

          alert(lines.join("\n"));
        } finally {
          hideLoading();
        }
      };
    }

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
      } else {
        state.map.addLayer(state.pdfOverlay);
        toggleBtn.textContent = "Hide PDF Overlay";
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
      var centerInput = byId("center-coord");

      if (!fileInput.files.length) {
        alert("Please select a PDF.");
        return;
      }

      showLoading("Uploading PDF…");
      try {
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
          function parseLatLng(text) {
            if (!text || typeof text !== "string") return null;
            var parts = text.split(",").map(function (s) {
              return Number(String(s).trim());
            });
            if (parts.length !== 2 || parts.some(isNaN)) return null;
            return { lat: parts[0], lng: parts[1] };
          }

          var swParsed = parseLatLng(swInput.value);
          var neParsed = parseLatLng(neInput.value);
          var centerParsed = parseLatLng(centerInput ? centerInput.value : "");

          if (state.pdfOverlay) state.map.removeLayer(state.pdfOverlay);

          var imgPath = fileInput.files[0].name + ".png";
          var imageUrl = "/static/pdf_uploads/" + imgPath;

          // Option 1: SW/NE bounds
          if (swParsed && neParsed) {
            var manualBounds = [
              [swParsed.lat, swParsed.lng],
              [neParsed.lat, neParsed.lng],
            ];

            state.pdfOverlay = L.imageOverlay(imageUrl, manualBounds, {
              opacity: parseFloat(opacitySlider.value),
            }).addTo(state.map);

            state.map.fitBounds(manualBounds);
            toggleBtn.textContent = "Hide PDF Overlay";
            setPdfControlsEnabled(true);
            return;
          }

          // Option 2: center + adjust size with scale controls
          if (centerParsed) {
            function getImageSize(url) {
              return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                  resolve({ width: img.width, height: img.height });
                };
                img.onerror = function () {
                  resolve(null);
                };
                img.src = url;
              });
            }

            var size = await getImageSize(imageUrl);
            var ratio = size && size.height ? size.width / size.height : 1;
            var b = state.map.getBounds();
            var latSpan = Math.abs(b.getNorth() - b.getSouth());
            if (!isFinite(latSpan) || latSpan <= 0) latSpan = 0.02;
            var latHalf = latSpan / 4;
            if (!isFinite(latHalf) || latHalf <= 0) latHalf = 0.01;
            var lngHalf = latHalf * ratio;

            var centerBounds = [
              [centerParsed.lat - latHalf, centerParsed.lng - lngHalf],
              [centerParsed.lat + latHalf, centerParsed.lng + lngHalf],
            ];

            state.pdfOverlay = L.imageOverlay(imageUrl, centerBounds, {
              opacity: parseFloat(opacitySlider.value),
            }).addTo(state.map);

            state.map.fitBounds(centerBounds);
            toggleBtn.textContent = "Hide PDF Overlay";
            setPdfControlsEnabled(true);
            return;
          }

          alert(
            "No geospatial info found in PDF. Enter either SW & NE (lat,lng) OR Center (lat,lng), then use Scale to fit."
          );
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
        toggleBtn.textContent = "Hide PDF Overlay";
        setPdfControlsEnabled(true);
      } finally {
        hideLoading();
      }
    };
  }

  function init() {
    var state = {
      map: null,
      drawnItems: null,
      selectedPolygon: null,
      pdfOverlay: null,
    };

    function escapeXml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }

    function ringToKmlCoordinates(ring) {
      // ring: [[lng,lat],[lng,lat],...]
      if (!Array.isArray(ring) || ring.length === 0) return "";
      return ring
        .map(function (pt) {
          if (!pt || pt.length < 2) return "";
          var lng = Number(pt[0]);
          var lat = Number(pt[1]);
          if (!isFinite(lng) || !isFinite(lat)) return "";
          return lng + "," + lat + ",0";
        })
        .filter(Boolean)
        .join(" ");
    }

    function polygonCoordsToKmlPolygon(rings) {
      // rings: [outerRing, holeRing1, holeRing2, ...]
      if (!Array.isArray(rings) || rings.length === 0) return "";
      var outer = rings[0];
      var holes = rings.slice(1);
      var xml = "<Polygon>";
      xml += "<outerBoundaryIs><LinearRing><coordinates>";
      xml += ringToKmlCoordinates(outer);
      xml += "</coordinates></LinearRing></outerBoundaryIs>";

      holes.forEach(function (hole) {
        xml += "<innerBoundaryIs><LinearRing><coordinates>";
        xml += ringToKmlCoordinates(hole);
        xml += "</coordinates></LinearRing></innerBoundaryIs>";
      });

      xml += "</Polygon>";
      return xml;
    }

    function featureToKmlPlacemark(feature) {
      if (!feature || !feature.geometry) return "";
      var geom = feature.geometry;
      var props = feature.properties || {};
      var name = props.name ? String(props.name) : "Polygon";
      var xml = "<Placemark>";
      xml += "<name>" + escapeXml(name) + "</name>";

      if (geom.type === "Polygon") {
        xml += polygonCoordsToKmlPolygon(geom.coordinates);
      } else if (geom.type === "MultiPolygon") {
        xml += "<MultiGeometry>";
        (geom.coordinates || []).forEach(function (polyRings) {
          xml += polygonCoordsToKmlPolygon(polyRings);
        });
        xml += "</MultiGeometry>";
      } else {
        // Only polygons are expected in this app.
        xml += "";
      }

      xml += "</Placemark>";
      return xml;
    }

    function geojsonToKml(geojson) {
      var features = [];
      if (!geojson) {
        features = [];
      } else if (geojson.type === "FeatureCollection") {
        features = geojson.features || [];
      } else if (geojson.type === "Feature") {
        features = [geojson];
      }

      var kml = '<?xml version="1.0" encoding="UTF-8"?>';
      kml += '<kml xmlns="http://www.opengis.net/kml/2.2">';
      kml += "<Document>";
      features.forEach(function (f) {
        kml += featureToKmlPlacemark(f);
      });
      kml += "</Document></kml>";
      return kml;
    }

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
      var formatEl = byId("download-format");
      var format = (
        formatEl && formatEl.value ? formatEl.value : "kml"
      ).toLowerCase();

      var contents;
      var mime;
      var filename;

      if (format === "geojson") {
        contents = JSON.stringify(data, null, 2);
        mime = "application/json";
        filename = "drawn_polygons.geojson";
      } else {
        contents = geojsonToKml(data);
        mime = "application/vnd.google-earth.kml+xml";
        filename = "drawn_polygons.kml";
      }

      var blob = new Blob([contents], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
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
