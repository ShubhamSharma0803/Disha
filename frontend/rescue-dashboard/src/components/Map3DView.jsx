import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { haversineDistance, calculateBoundaryBox, offsetToGps } from '../utils/geoMath';

// ─── Configuration ───────────────────────────────────────────────────────────

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

const INITIAL_ZOOM = 14;
const INITIAL_PITCH = 58;
const INITIAL_BEARING = -15;

/** RGBA colours keyed by node status */
const STATUS_RGBA = {
  PLANNED: [96, 165, 250, 240],   // blue-400
  ACTIVE:  [52, 211, 153, 240],   // emerald-400
  OFFLINE: [248, 113, 113, 240],  // red-400
};

/** Duration of camera fly-to animation when centre changes (ms) */
const FLY_DURATION_MS = 2000;

/** Drone flight simulation speed (m/s) */
const DRONE_SPEED_M_PER_S = 180;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a 64-point circular polygon for Wi-Fi coverage rings.
 */
function createCircleGeoJSON(centerLng, centerLat, radiusM, steps = 64) {
  const coords = [];
  const distRadians = radiusM / 6_371_000;

  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const lat = Math.asin(
      Math.sin((centerLat * Math.PI) / 180) * Math.cos(distRadians) +
        Math.cos((centerLat * Math.PI) / 180) *
          Math.sin(distRadians) *
          Math.cos(angle),
    );
    const lng =
      (centerLng * Math.PI) / 180 +
      Math.atan2(
        Math.sin(angle) * Math.sin(distRadians) * Math.cos((centerLat * Math.PI) / 180),
        Math.cos(distRadians) - Math.sin((centerLat * Math.PI) / 180) * Math.sin(lat),
      );
    coords.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {},
  };
}

/**
 * Build GeoJSON Feature for the boundary box.
 */
function getBoundaryGeoJSON(centerLat, centerLon, areaSqKm) {
  const ring = calculateBoundaryBox(centerLat, centerLon, areaSqKm);
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
    properties: {},
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Map3DView — 3D satellite map view where all ground overlays (boundaries, coverage disks,
 * mesh lines, node pins, and labels) are draped directly onto the 3D terrain surface with
 * zero parallax drift, while simulation drones fly in 3D space above the terrain.
 */
export default function Map3DView({
  centerLat,
  centerLon,
  areaSqKm = 4,
  nodes = [],
  selectedNode = null,
  setSelectedNode,
  isSimulating = false,
  links = [],
  gateway = null,
  highlightedPath = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const animationRef = useRef(null);
  const prevCenterRef = useRef({ lat: centerLat, lon: centerLon });
  const mapReadyRef = useRef(false);
  const [is3DMode, setIs3DMode] = useState(true);

  // Keep references to latest props for synchronous rAF loop access
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const selectedNodeRef = useRef(selectedNode);
  selectedNodeRef.current = selectedNode;

  const highlightedPathRef = useRef(highlightedPath);
  highlightedPathRef.current = highlightedPath;

  const centerLatRef = useRef(centerLat);
  centerLatRef.current = centerLat;

  const centerLonRef = useRef(centerLon);
  centerLonRef.current = centerLon;

  const areaSqKmRef = useRef(areaSqKm);
  areaSqKmRef.current = areaSqKm;

  const linksRef = useRef(links);
  linksRef.current = links;

  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  const activeDronesRef = useRef([]);

  // ── Query terrain elevation in metres at any [lon, lat] coordinate ───────
  const getTerrainAlt = useCallback((lon, lat) => {
    const map = mapRef.current;
    if (!map) return 0;
    try {
      const ele = map.queryTerrainElevation([lon, lat]);
      return typeof ele === 'number' && !Number.isNaN(ele) ? ele : 0;
    } catch {
      return 0;
    }
  }, []);

  // ── Synchronize native Mapbox draped layers (draped directly onto 3D terrain) ──
  const syncMapboxDrapedLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const cLat = centerLatRef.current;
    const cLon = centerLonRef.current;
    const currentArea = areaSqKmRef.current;
    const currentNodes = nodesRef.current;
    const currentSelected = selectedNodeRef.current;
    const currentLinks = linksRef.current || [];

    const sideM = Math.sqrt(Math.max(0.1, Number(currentArea) || 4)) * 1000;
    const defaultGateway = offsetToGps(cLat, cLon, 0, -sideM / 2);
    const currentGateway = gatewayRef.current || defaultGateway;
    const gwLon = currentGateway.lon;
    const gwLat = currentGateway.lat;

    // 1. Update boundary box GeoJSON
    const boundarySrc = map.getSource('boundary-box-draped');
    if (boundarySrc) {
      boundarySrc.setData(getBoundaryGeoJSON(cLat, cLon, currentArea));
    }

    // 2. Update Wi-Fi coverage circles (displayed for ALL nodes!)
    const coverageSrc = map.getSource('coverage-circles-draped');
    if (coverageSrc) {
      const features = currentNodes.map((n) => {
        const feat = createCircleGeoJSON(n.lon, n.lat, n.wifiRadiusM || 300);
        feat.properties = {
          id: n.id,
          status: n.status || 'PLANNED',
          isSelected: n.id === currentSelected,
        };
        return feat;
      });
      coverageSrc.setData({
        type: 'FeatureCollection',
        features,
      });
    }

    // 3. Update mesh links GeoJSON (lines connecting nodes and gateway)
    const linksSrc = map.getSource('mesh-links-draped');
    if (linksSrc) {
      const nodeMap = new Map();
      currentNodes.forEach((n) => nodeMap.set(n.id, n));
      nodeMap.set('GATEWAY', { id: 'GATEWAY', lon: gwLon, lat: gwLat, status: 'ACTIVE' });

      const linkFeatures = currentLinks
        .map((lnk) => {
          const fromNode = nodeMap.get(lnk.from);
          const toNode = nodeMap.get(lnk.to);
          if (!fromNode || !toNode) return null;
          return {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [fromNode.lon, fromNode.lat],
                [toNode.lon, toNode.lat],
              ],
            },
            properties: {
              from: lnk.from,
              to: lnk.to,
              distance_m: lnk.distance_m || 0,
              isActive: fromNode.status === 'ACTIVE' && toNode.status === 'ACTIVE',
            },
          };
        })
        .filter(Boolean);

      linksSrc.setData({
        type: 'FeatureCollection',
        features: linkFeatures,
      });
    }

    // 4. Update node pins GeoJSON (points on the ground)
    const pinsSrc = map.getSource('node-pins-draped');
    if (pinsSrc) {
      const pinFeatures = currentNodes.map((n, idx) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [n.lon, n.lat],
        },
        properties: {
          id: n.id,
          status: n.status || 'PLANNED',
          isSelected: n.id === currentSelected,
          label: n.id.replace('NODE-', '').replace(/^0+/, '') || String(idx + 1),
          altM: n.altM ?? 25,
          wifiRadiusM: n.wifiRadiusM ?? 300,
          hops: n.hopsFromGateway ?? 1,
        },
      }));

      pinsSrc.setData({
        type: 'FeatureCollection',
        features: pinFeatures,
      });
    }

    // 5. Update gateway marker GeoJSON
    const gwSrc = map.getSource('gateway-draped');
    if (gwSrc) {
      gwSrc.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [gwLon, gwLat],
            },
            properties: {
              id: 'GATEWAY',
              label: 'GW',
            },
          },
        ],
      });
    }

    // 6. Update shortest path to Gateway (highlighted in black)
    const pathSrc = map.getSource('shortest-path-draped');
    if (pathSrc) {
      const currentPath = highlightedPathRef.current;
      if (currentPath && currentPath.length >= 2) {
        const nodeMap = new Map();
        currentNodes.forEach((n) => nodeMap.set(n.id, n));
        nodeMap.set('GATEWAY', { id: 'GATEWAY', lon: gwLon, lat: gwLat });

        const coords = currentPath
          .map((id) => nodeMap.get(id))
          .filter(Boolean)
          .map((n) => [n.lon, n.lat]);

        if (coords.length >= 2) {
          pathSrc.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: coords,
                },
                properties: {},
              },
            ],
          });
        } else {
          pathSrc.setData({ type: 'FeatureCollection', features: [] });
        }
      } else {
        pathSrc.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, []);

  // ── Build Deck.gl 3D simulation layers (drones in the air) ───────────────
  const buildLayers = useCallback((activeDrones = []) => {
    const currentNodes = nodesRef.current;
    const currentSelected = selectedNodeRef.current;

    const layers = [];

    // Selected node 3D beacon halo
    if (currentSelected) {
      const sel = currentNodes.find((n) => n.id === currentSelected);
      if (sel) {
        const groundAlt = getTerrainAlt(sel.lon, sel.lat);
        layers.push(
          new ScatterplotLayer({
            id: 'selected-node-beacon-layer',
            data: [sel],
            getPosition: (d) => [d.lon, d.lat, groundAlt + 20],
            getRadius: 28,
            radiusUnits: 'meters',
            radiusMinPixels: 12,
            radiusMaxPixels: 55,
            filled: false,
            stroked: true,
            getLineColor: [250, 204, 21, 255],
            getLineWidth: 3,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }
    }

    // Active autonomous drones flying in 3D during simulation
    if (activeDrones.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'active-drones-halo-layer',
          data: activeDrones,
          getPosition: (d) => {
            const ground = getTerrainAlt(d.currentLon, d.currentLat);
            return [d.currentLon, d.currentLat, ground + (d.currentAlt || 35)];
          },
          getRadius: 26,
          radiusUnits: 'meters',
          radiusMinPixels: 10,
          radiusMaxPixels: 45,
          filled: false,
          stroked: true,
          getLineColor: (d) => [d.color[0], d.color[1], d.color[2], 160],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: false,
        }),
        new ScatterplotLayer({
          id: 'active-drones-layer',
          data: activeDrones,
          getPosition: (d) => {
            const ground = getTerrainAlt(d.currentLon, d.currentLat);
            return [d.currentLon, d.currentLat, ground + (d.currentAlt || 35)];
          },
          getRadius: 16,
          radiusUnits: 'meters',
          radiusMinPixels: 8,
          radiusMaxPixels: 30,
          filled: true,
          stroked: true,
          getFillColor: (d) => d.color,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: true,
        }),
      );
    }

    return layers;
  }, [getTerrainAlt]);

  // Push updated layers to MapboxOverlay
  const renderDeckLayers = useCallback(
    (drones = activeDronesRef.current) => {
      const overlay = overlayRef.current;
      if (!overlay || !mapReadyRef.current) return;
      overlay.setProps({ layers: buildLayers(drones) });
    },
    [buildLayers],
  );

  // ── Initialise Mapbox Map & MapboxOverlay ─────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      console.error('Map3DView: VITE_MAPBOX_TOKEN is not set.');
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [centerLon, centerLat],
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: INITIAL_BEARING,
      antialias: true,
      projection: 'mercator',
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    const overlay = new MapboxOverlay({
      layers: [],
      getTooltip: ({ object, layer }) => {
        if (!object || !layer) return null;
        if (layer.id === 'active-drones-layer') {
          return {
            html: `
              <div style="font-family:Inter,system-ui,sans-serif;padding:6px 10px;background:#0f172aee;color:#facc15;border:1px solid #ca8a04;border-radius:6px;font-size:11px;">
                <strong>Autonomous Mesh Drone</strong><br/>
                Destination: ${object.nodeId} (${Math.round((object.progress || 0) * 100)}%)
              </div>
            `,
            style: { backgroundColor: 'transparent', padding: 0, border: 'none' },
          };
        }
        return null;
      },
    });

    map.addControl(overlay);
    overlayRef.current = overlay;

    // Rich popup for ground-pinned nodes
    const nodePopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
    });

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6,
      });

      // Add 3D terrain DEM
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.15 });
      }

      // ── 1. Disaster Boundary Box (Draped Polygon) ────────────────────────
      if (!map.getSource('boundary-box-draped')) {
        map.addSource('boundary-box-draped', {
          type: 'geojson',
          data: getBoundaryGeoJSON(centerLat, centerLon, areaSqKm),
        });

        map.addLayer({
          id: 'boundary-box-fill-draped',
          type: 'fill',
          source: 'boundary-box-draped',
          paint: {
            'fill-color': '#8b5cf6',
            'fill-opacity': 0.12,
          },
        });

        map.addLayer({
          id: 'boundary-box-line-draped',
          type: 'line',
          source: 'boundary-box-draped',
          paint: {
            'line-color': '#06b6d4',
            'line-width': 3,
            'line-opacity': 0.95,
          },
        });
      }

      // ── 2. Wi-Fi Coverage Circles (Draped on ground) ─────────────────────
      if (!map.getSource('coverage-circles-draped')) {
        map.addSource('coverage-circles-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'coverage-circles-fill-draped',
          type: 'fill',
          source: 'coverage-circles-draped',
          paint: {
            'fill-color': [
              'case',
              ['==', ['get', 'status'], 'ACTIVE'],
              '#34d399',
              '#38bdf8',
            ],
            'fill-opacity': [
              'case',
              ['==', ['get', 'status'], 'ACTIVE'],
              0.16,
              0.08,
            ],
          },
        });

        map.addLayer({
          id: 'coverage-circles-line-draped',
          type: 'line',
          source: 'coverage-circles-draped',
          paint: {
            'line-color': [
              'case',
              ['==', ['get', 'status'], 'ACTIVE'],
              '#34d399',
              '#38bdf8',
            ],
            'line-width': [
              'case',
              ['==', ['get', 'status'], 'ACTIVE'],
              2,
              1.2,
            ],
            'line-opacity': 0.8,
            'line-dasharray': [
              'case',
              ['==', ['get', 'status'], 'ACTIVE'],
              ['literal', [1, 0]],
              ['literal', [4, 3]],
            ],
          },
        });
      }

      // ── 3. LoRa Mesh Links (Draped Lines on ground) ──────────────────────
      if (!map.getSource('mesh-links-draped')) {
        map.addSource('mesh-links-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'mesh-links-line-draped',
          type: 'line',
          source: 'mesh-links-draped',
          paint: {
            'line-color': [
              'case',
              ['get', 'isActive'],
              '#34d399',
              '#38bdf8',
            ],
            'line-width': [
              'case',
              ['get', 'isActive'],
              2.8,
              1.8,
            ],
            'line-opacity': 0.75,
          },
        });
      }

      // ── 3b. Shortest Path to Gateway (Draped Black Line) ─────────────────
      if (!map.getSource('shortest-path-draped')) {
        map.addSource('shortest-path-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'shortest-path-line-draped',
          type: 'line',
          source: 'shortest-path-draped',
          paint: {
            'line-color': '#000000',
            'line-width': 5.5,
            'line-opacity': 1.0,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      // ── 4. Gateway Base Station (Draped Circle & Label) ──────────────────
      if (!map.getSource('gateway-draped')) {
        map.addSource('gateway-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'gateway-circle-draped',
          type: 'circle',
          source: 'gateway-draped',
          paint: {
            'circle-radius': 12,
            'circle-color': '#f97316',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
            'circle-pitch-alignment': 'map',
          },
        });

        map.addLayer({
          id: 'gateway-label-draped',
          type: 'symbol',
          source: 'gateway-draped',
          layout: {
            'text-field': 'GATEWAY',
            'text-size': 11,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.5],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#fb923c',
            'text-halo-color': '#0f172a',
            'text-halo-width': 2.5,
          },
        });
      }

      // ── 5. Node Pins & Labels (Draped Circles on ground) ─────────────────
      if (!map.getSource('node-pins-draped')) {
        map.addSource('node-pins-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'node-pins-circle-draped',
          type: 'circle',
          source: 'node-pins-draped',
          paint: {
            'circle-radius': [
              'case',
              ['get', 'isSelected'],
              11,
              7.5,
            ],
            'circle-color': [
              'match',
              ['get', 'status'],
              'ACTIVE', '#34d399',
              'OFFLINE', '#f87171',
              '#60a5fa',
            ],
            'circle-stroke-width': [
              'case',
              ['get', 'isSelected'],
              3,
              2,
            ],
            'circle-stroke-color': [
              'case',
              ['get', 'isSelected'],
              '#facc15',
              '#ffffff',
            ],
            'circle-pitch-alignment': 'map',
          },
        });

        map.addLayer({
          id: 'node-labels-draped',
          type: 'symbol',
          source: 'node-pins-draped',
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 10,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.4],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#0f172a',
            'text-halo-width': 2,
          },
        });
      }

      // Interactive hover popup for node pins
      map.on('mouseenter', 'node-pins-circle-draped', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features || !e.features[0]) return;
        const p = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const col = p.status === 'ACTIVE' ? '#34d399' : '#60a5fa';

        nodePopup
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:Inter,system-ui,sans-serif;padding:8px 12px;background:#0f172af2;color:#f8fafc;border:1px solid #334155;border-radius:8px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);">
              <div style="font-weight:700;font-size:13px;color:#38bdf8;margin-bottom:3px;">${p.id}</div>
              <div>Status: <span style="font-weight:600;color:${col}">${p.status}</span></div>
              <div>Altitude: <span style="color:#cbd5e1;">${p.altM || 25} m AGL</span></div>
              <div>Wi-Fi Range: <span style="color:#cbd5e1;">${p.wifiRadiusM || 300} m</span></div>
              <div style="font-size:10px;color:#94a3b8;margin-top:3px;">${coords[1].toFixed(5)}°N, ${coords[0].toFixed(5)}°E</div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseleave', 'node-pins-circle-draped', () => {
        map.getCanvas().style.cursor = '';
        nodePopup.remove();
      });

      map.on('click', 'node-pins-circle-draped', (e) => {
        if (e.features && e.features[0]) {
          setSelectedNode?.(e.features[0].properties.id);
        }
      });

      // Hover popup for Gateway
      map.on('mouseenter', 'gateway-circle-draped', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const coords = e.features[0].geometry.coordinates.slice();
        nodePopup
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:Inter,system-ui,sans-serif;padding:8px 12px;background:#0f172af2;color:#f8fafc;border:1px solid #ea580c;border-radius:8px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);">
              <div style="font-weight:700;font-size:13px;color:#fb923c;margin-bottom:3px;">Base Station Gateway</div>
              <div>LoRa Mesh Root & Launch Pad</div>
              <div style="font-size:10px;color:#94a3b8;margin-top:3px;">${coords[1].toFixed(5)}°N, ${coords[0].toFixed(5)}°E</div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseleave', 'gateway-circle-draped', () => {
        map.getCanvas().style.cursor = '';
        nodePopup.remove();
      });
    });

    map.on('load', () => {
      mapReadyRef.current = true;
      syncMapboxDrapedLayers();
      renderDeckLayers();
    });

    // Re-render Deck.gl simulation layer when DEM terrain finishes loading
    map.on('idle', () => {
      if (activeDronesRef.current.length > 0 || selectedNodeRef.current) {
        renderDeckLayers();
      }
    });

    mapRef.current = map;

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      nodePopup.remove();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      mapReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fly to new centre smoothly ONLY when centre coordinates explicitly change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const prev = prevCenterRef.current;
    if (prev.lat === centerLat && prev.lon === centerLon) return;

    prevCenterRef.current = { lat: centerLat, lon: centerLon };

    map.flyTo({
      center: [centerLon, centerLat],
      duration: FLY_DURATION_MS,
      essential: true,
    });
  }, [centerLat, centerLon]);

  // ── Synchronise layers when props change ─────────────────────────────────
  useEffect(() => {
    syncMapboxDrapedLayers();
    renderDeckLayers();
  }, [nodes, selectedNode, centerLat, centerLon, areaSqKm, links, gateway, highlightedPath, syncMapboxDrapedLayers, renderDeckLayers]);

  // ── Autonomous Multi-Drone Simulation Animation ──────────────────────────
  useEffect(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (!isSimulating || !mapReadyRef.current) {
      activeDronesRef.current = [];
      renderDeckLayers([]);
      return;
    }

    const cLat = centerLatRef.current;
    const cLon = centerLonRef.current;
    const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKmRef.current) || 4)) * 1000;
    const defaultGateway = offsetToGps(cLat, cLon, 0, -sideM / 2);
    const currentGateway = gatewayRef.current || defaultGateway;
    const launchLon = currentGateway.lon;
    const launchLat = currentGateway.lat;

    const plannedNodes = nodesRef.current.filter((n) => n.status === 'PLANNED');
    if (plannedNodes.length === 0) {
      activeDronesRef.current = [];
      renderDeckLayers([]);
      return;
    }

    // Initialize drone instances
    const drones = plannedNodes.map((node, i) => {
      const totalDistM = haversineDistance(launchLat, launchLon, node.lat, node.lon);
      return {
        id: `drone-${node.id}`,
        node,
        nodeId: node.id,
        from: { lat: launchLat, lon: launchLon },
        to: { lat: node.lat, lon: node.lon },
        currentLat: launchLat,
        currentLon: launchLon,
        currentAlt: 35,
        totalDistM,
        durationS: Math.max(1.8, totalDistM / DRONE_SPEED_M_PER_S),
        progress: 0,
        arrived: false,
        staggerDelay: i * 0.22,
        waitAccum: 0,
        color: i % 2 === 0 ? [250, 204, 21, 255] : [34, 211, 238, 255],
      };
    });

    activeDronesRef.current = drones;
    renderDeckLayers(drones);

    let lastTimestamp = null;

    const animate = (timestamp) => {
      if (!mapRef.current || !overlayRef.current) return;

      if (!lastTimestamp) lastTimestamp = timestamp;
      const deltaS = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;

      let allArrived = true;

      drones.forEach((drone) => {
        if (drone.arrived) return;

        if (drone.waitAccum < drone.staggerDelay) {
          drone.waitAccum += deltaS;
          allArrived = false;
          return;
        }

        drone.progress += deltaS / drone.durationS;

        if (drone.progress >= 1) {
          drone.progress = 1;
          drone.arrived = true;
          drone.currentLat = drone.to.lat;
          drone.currentLon = drone.to.lon;
          drone.currentAlt = drone.node.altM || 25;

          // Dispatch arrival event so status turns ACTIVE
          window.dispatchEvent(
            new CustomEvent('drone:node-arrived', {
              detail: { nodeId: drone.nodeId },
            }),
          );
        } else {
          allArrived = false;
          // Smooth sinusoidal ease-in-out interpolation
          const ease = 0.5 - 0.5 * Math.cos(Math.PI * drone.progress);
          drone.currentLat = drone.from.lat + (drone.to.lat - drone.from.lat) * ease;
          drone.currentLon = drone.from.lon + (drone.to.lon - drone.from.lon) * ease;
          // Parabolic cruising altitude arc
          drone.currentAlt = 25 + Math.sin(Math.PI * drone.progress) * 45;
        }
      });

      renderDeckLayers(drones);

      if (!allArrived) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      activeDronesRef.current = [];
    };
  }, [isSimulating, renderDeckLayers]);

  // ── Camera control actions ────────────────────────────────────────────────
  const handleToggle3D = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setIs3DMode((prev) => {
      const next = !prev;
      map.easeTo({
        pitch: next ? INITIAL_PITCH : 0,
        bearing: next ? INITIAL_BEARING : 0,
        duration: 1000,
      });
      return next;
    });
  }, []);

  const handleFocusArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const sideKm = Math.sqrt(Math.max(0.1, Number(areaSqKmRef.current) || 4));
    const targetZoom = Math.max(11, Math.min(16, 14.6 - Math.log2(sideKm)));
    map.flyTo({
      center: [centerLonRef.current, centerLatRef.current],
      zoom: targetZoom,
      pitch: is3DMode ? INITIAL_PITCH : 0,
      bearing: is3DMode ? INITIAL_BEARING : 0,
      duration: 1400,
    });
  }, [is3DMode]);

  const handleResetNorth = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.rotateTo(0, { duration: 800 });
  }, []);

  // ── Render container ─────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      />

      {/* Floating View Controls Toolbar */}
      <div className="map-toolbar">
        <button
          type="button"
          className={`map-toolbar__btn ${is3DMode ? 'map-toolbar__btn--active' : ''}`}
          onClick={handleToggle3D}
          title="Toggle 3D Perspective / 2D Top-Down"
        >
          {is3DMode ? '🏔 3D View' : '🗺 2D Top-Down'}
        </button>
        <button
          type="button"
          className="map-toolbar__btn"
          onClick={handleFocusArea}
          title="Recenter camera on disaster boundary"
        >
          🎯 Focus Area
        </button>
        <button
          type="button"
          className="map-toolbar__btn"
          onClick={handleResetNorth}
          title="Reset camera heading to North"
        >
          🧭 North
        </button>
      </div>

      {/* Map Legend Overlay */}
      <div className="map-legend">
        <div className="map-legend__item">
          <span className="map-legend__box" style={{ borderColor: '#06b6d4', background: 'rgba(139,92,246,0.25)' }} />
          <span>Disaster Zone ({Number(areaSqKm).toFixed(1)} km²)</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__dot" style={{ background: '#60a5fa' }} />
          <span>Nodes ({nodes.length})</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__dot" style={{ background: '#f97316' }} />
          <span>Gateway Base Station</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__ring" style={{ borderColor: '#38bdf8' }} />
          <span>Wi-Fi Hotspot Radius</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__line" style={{ background: '#38bdf8' }} />
          <span>LoRa Mesh Links</span>
        </div>
      </div>
    </div>
  );
}
