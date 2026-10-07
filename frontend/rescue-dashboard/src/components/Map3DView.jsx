import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { haversineDistance, calculateBoundaryBox, offsetToGps } from '../utils/geoMath';
import { normalizeNodeId } from '../utils/nodeUtils';
import { subscribe } from '../state/meshEvents';
import { SOS_CATEGORIES } from '../state/sosStore';

// ─── Configuration ───────────────────────────────────────────────────────────

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

const INITIAL_ZOOM = 14;
const INITIAL_PITCH = 58;
const INITIAL_BEARING = -15;

/** RGBA colours keyed by node status */
const STATUS_RGBA = {
  PLANNED: [148, 163, 184, 240],   // slate-400 #94A3B8
  ACTIVE:  [16, 185, 129, 240],    // emerald-500 #10B981
  OFFLINE: [239, 68, 68, 240],     // red-500 #EF4444
};

/** Priority RGB colors for origin pulsing beacon rings */
const PRIORITY_COLORS = {
  1: [239, 68, 68],   // Red (MED, TRP)
  2: [245, 158, 11],  // Amber (MIS)
  3: [59, 130, 246],  // Blue (FWD, SHL)
  4: [16, 185, 129],  // Emerald (SAF)
};

/** Hop animation duration in milliseconds (~0.6s) */
const HOP_DURATION_MS = 600;

/** Smooth cubic ease-in-out easing function */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
const Map3DView = forwardRef(function Map3DView({
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
}, ref) {
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

  // SOS packet animation refs
  const trackedSosPacketsRef = useRef(new Map());
  const failedSosLinksRef = useRef([]);
  const gatewayPulsesRef = useRef([]);
  const sosAnimDataRef = useRef({
    originRings: [],
    gatewayPulses: [],
    activeDots: [],
    activeDotsGlow: [],
    trails: [],
    droppedDots: [],
  });
  const sosAnimationRef = useRef(null);

  // ── Lookup GPS coordinates for any node ID or GATEWAY ───────────────────
  const getNodeCoord = useCallback((nodeId) => {
    if (!nodeId) return null;
    const norm = normalizeNodeId(nodeId);
    if (norm === 'GATEWAY') {
      const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKmRef.current) || 4)) * 1000;
      const defaultGateway = offsetToGps(centerLatRef.current, centerLonRef.current, 0, -sideM / 2);
      const gw = gatewayRef.current || defaultGateway;
      return [gw.lon, gw.lat];
    }
    const n = nodesRef.current.find((item) => normalizeNodeId(item.id) === norm);
    if (n) return [n.lon, n.lat];
    return null;
  }, []);

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
      currentNodes.forEach((n) => nodeMap.set(normalizeNodeId(n.id), n));
      nodeMap.set('GATEWAY', { id: 'GATEWAY', lon: gwLon, lat: gwLat, status: 'ACTIVE' });

      const linkFeatures = currentLinks
        .map((lnk) => {
          const fromNode = nodeMap.get(normalizeNodeId(lnk.from));
          const toNode = nodeMap.get(normalizeNodeId(lnk.to));
          if (!fromNode || !toNode) return null;
          const isOffline = fromNode.status === 'OFFLINE' || toNode.status === 'OFFLINE';
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
              isOffline: isOffline,
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

  // ── Build Deck.gl 3D simulation layers (drones in the air + SOS beacons) ──
  const buildLayers = useCallback((activeDrones = [], sosData = sosAnimDataRef.current) => {
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

    // ── Real-time SOS telemetry visual overlays ──────────────────────────────
    if (sosData) {
      // 1. Origin pulsing beacon rings in priority color until delivery
      if (sosData.originRings && sosData.originRings.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-origin-rings-layer',
            data: sosData.originRings,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 3],
            getRadius: (d) => d.radius,
            radiusUnits: 'meters',
            radiusMinPixels: 10,
            radiusMaxPixels: 50,
            filled: false,
            stroked: true,
            getLineColor: (d) => [...d.color, d.alpha],
            getLineWidth: 2.5,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }

      // 2. Gateway emerald delivered pulse rings
      if (sosData.gatewayPulses && sosData.gatewayPulses.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-gateway-pulses-layer',
            data: sosData.gatewayPulses,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 4],
            getRadius: (d) => d.radius,
            radiusUnits: 'meters',
            radiusMinPixels: 12,
            radiusMaxPixels: 64,
            filled: false,
            stroked: true,
            getLineColor: (d) => [16, 185, 129, d.alpha],
            getLineWidth: 3.5,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }

      // 3. Fading comet trails behind active hopping packets
      if (sosData.trails && sosData.trails.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-trails-layer',
            data: sosData.trails,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 5],
            getRadius: (d) => d.radius,
            radiusUnits: 'meters',
            radiusMinPixels: 3,
            radiusMaxPixels: 18,
            filled: true,
            stroked: false,
            getFillColor: (d) => [255, 107, 53, d.alpha],
            pickable: false,
          }),
        );
      }

      // 4. Soft glowing halos around moving packet dots
      if (sosData.activeDotsGlow && sosData.activeDotsGlow.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-active-dots-glow-layer',
            data: sosData.activeDotsGlow,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 6],
            getRadius: 22,
            radiusUnits: 'meters',
            radiusMinPixels: 12,
            radiusMaxPixels: 45,
            filled: true,
            stroked: true,
            getFillColor: [255, 107, 53, 65],
            getLineColor: [255, 130, 70, 140],
            getLineWidth: 1.5,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }

      // 5. Active hopping glowing dots (#FF6B35)
      if (sosData.activeDots && sosData.activeDots.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-active-dots-layer',
            data: sosData.activeDots,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 7],
            getRadius: 11,
            radiusUnits: 'meters',
            radiusMinPixels: 6,
            radiusMaxPixels: 20,
            filled: true,
            stroked: true,
            getFillColor: [255, 107, 53, 255],
            getLineColor: [255, 255, 255, 255],
            getLineWidth: 2,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }

      // 6. Dropped packet fading red dots at failure node
      if (sosData.droppedDots && sosData.droppedDots.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: 'sos-dropped-dots-layer',
            data: sosData.droppedDots,
            getPosition: (d) => [d.lon, d.lat, getTerrainAlt(d.lon, d.lat) + 7],
            getRadius: (d) => d.radius,
            radiusUnits: 'meters',
            radiusMinPixels: 8,
            radiusMaxPixels: 30,
            filled: true,
            stroked: true,
            getFillColor: (d) => [239, 68, 68, d.alpha],
            getLineColor: (d) => [255, 255, 255, d.alpha],
            getLineWidth: 2,
            lineWidthUnits: 'pixels',
            pickable: false,
          }),
        );
      }
    }

    return layers;
  }, [getTerrainAlt]);

  // Push updated layers to MapboxOverlay
  const renderDeckLayers = useCallback(
    (drones = activeDronesRef.current, sosData = sosAnimDataRef.current) => {
      const overlay = overlayRef.current;
      if (!overlay || !mapReadyRef.current) return;
      overlay.setProps({ layers: buildLayers(drones, sosData) });
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
              'match',
              ['get', 'status'],
              'ACTIVE', '#10B981',
              'OFFLINE', '#EF4444',
              '#94A3B8',
            ],
            'fill-opacity': [
              'match',
              ['get', 'status'],
              'ACTIVE', 0.14,
              'OFFLINE', 0.04,
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
              'match',
              ['get', 'status'],
              'ACTIVE', '#10B981',
              'OFFLINE', '#EF4444',
              '#94A3B8',
            ],
            'line-width': [
              'match',
              ['get', 'status'],
              'ACTIVE', 2,
              'OFFLINE', 1.8,
              1.2,
            ],
            'line-opacity': [
              'match',
              ['get', 'status'],
              'OFFLINE', 0.55,
              0.75,
            ],
            'line-dasharray': [
              'match',
              ['get', 'status'],
              'ACTIVE', ['literal', [1, 0]],
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

        // Active / Live Links: Blue, solid
        map.addLayer({
          id: 'mesh-links-line-draped',
          type: 'line',
          source: 'mesh-links-draped',
          filter: ['!=', ['get', 'isOffline'], true],
          paint: {
            'line-color': '#3B82F6',
            'line-width': [
              'case',
              ['get', 'isActive'],
              2.5,
              1.8,
            ],
            'line-opacity': 0.65,
          },
        });

        // Offline Links: Dashed and dimmed (gray, ~25% opacity)
        map.addLayer({
          id: 'mesh-links-offline-draped',
          type: 'line',
          source: 'mesh-links-draped',
          filter: ['==', ['get', 'isOffline'], true],
          paint: {
            'line-color': '#9CA3AF',
            'line-width': 1.8,
            'line-opacity': 0.25,
            'line-dasharray': [4, 4],
          },
        });
      }

      // ── 3b. Shortest Path to Gateway (Draped Black Line with White Casing) ─
      if (!map.getSource('shortest-path-draped')) {
        map.addSource('shortest-path-draped', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // White casing underlay for high contrast on satellite imagery
        map.addLayer({
          id: 'shortest-path-casing-draped',
          type: 'line',
          source: 'shortest-path-draped',
          paint: {
            'line-color': '#ffffff',
            'line-width': 7.5,
            'line-opacity': 0.95,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });

        map.addLayer({
          id: 'shortest-path-line-draped',
          type: 'line',
          source: 'shortest-path-draped',
          paint: {
            'line-color': '#18181B',
            'line-width': 4.5,
            'line-opacity': 1.0,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      // ── 3c. SOS Travelled Paths (Draped Orange Line with White Casing) ───
      if (!map.getSource('sos-travelled-paths')) {
        map.addSource('sos-travelled-paths', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'sos-travelled-paths-casing-draped',
          type: 'line',
          source: 'sos-travelled-paths',
          paint: {
            'line-color': '#ffffff',
            'line-width': 7.5,
            'line-opacity': ['coalesce', ['get', 'opacity'], 0.95],
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });

        map.addLayer({
          id: 'sos-travelled-paths-line-draped',
          type: 'line',
          source: 'sos-travelled-paths',
          paint: {
            'line-color': '#FF6B35',
            'line-width': 4.5,
            'line-opacity': ['coalesce', ['get', 'opacity'], 1.0],
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }

      // ── 3d. SOS Failed Link Flash (Red Dashed Line) ──────────────────────
      if (!map.getSource('sos-failed-links')) {
        map.addSource('sos-failed-links', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'sos-failed-links-line-draped',
          type: 'line',
          source: 'sos-failed-links',
          paint: {
            'line-color': '#EF4444',
            'line-width': 4.5,
            'line-opacity': 0.95,
            'line-dasharray': [3, 3],
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
            'circle-color': '#FF6B35',
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
            'text-color': '#ffffff',
            'text-halo-color': '#18181B',
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

        // Outer red ring for OFFLINE nodes
        map.addLayer({
          id: 'node-pins-offline-ring-draped',
          type: 'circle',
          source: 'node-pins-draped',
          filter: ['==', ['get', 'status'], 'OFFLINE'],
          paint: {
            'circle-radius': [
              'case',
              ['get', 'isSelected'],
              16,
              12.5,
            ],
            'circle-color': 'transparent',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#EF4444',
            'circle-stroke-opacity': 0.85,
            'circle-pitch-alignment': 'map',
          },
        });

        map.addLayer({
          id: 'node-pins-circle-draped',
          type: 'circle',
          source: 'node-pins-draped',
          paint: {
            'circle-radius': [
              'case',
              ['get', 'isSelected'],
              12,
              8.5,
            ],
            'circle-color': [
              'match',
              ['get', 'status'],
              'ACTIVE', '#10B981',
              'OFFLINE', '#EF4444',
              '#94A3B8',
            ],
            'circle-stroke-width': [
              'case',
              ['get', 'isSelected'],
              3.5,
              2,
            ],
            'circle-stroke-color': [
              'case',
              ['get', 'isSelected'],
              '#FF6B35',
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
            'text-offset': [0, 1.5],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#18181B',
            'text-halo-width': 2.5,
          },
        });
      }

      // Interactive hover popup for node pins
      map.on('mouseenter', 'node-pins-circle-draped', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features || !e.features[0]) return;
        const p = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        const col = p.status === 'ACTIVE' ? '#10B981' : p.status === 'OFFLINE' ? '#EF4444' : '#94A3B8';

        nodePopup
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:'Outfit',system-ui,sans-serif;padding:10px 14px;background:#18181Bf2;color:#f8fafc;border:1px solid #334155;border-radius:12px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
              <div style="font-weight:700;font-size:14px;color:#3B82F6;margin-bottom:4px;">${p.id}</div>
              <div style="margin-bottom:2px;">Status: <span style="font-weight:700;color:${col}">${p.status}</span></div>
              <div style="color:#cbd5e1;">Altitude: <strong>${p.altM || 25} m AGL</strong></div>
              <div style="color:#cbd5e1;">Wi-Fi Range: <strong>${p.wifiRadiusM || 300} m</strong></div>
              <div style="font-size:10px;color:#94a3b8;margin-top:4px;">${coords[1].toFixed(5)}°N, ${coords[0].toFixed(5)}°E</div>
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
      if (sosAnimationRef.current) {
        cancelAnimationFrame(sosAnimationRef.current);
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

  // ── Trigger packet delivery visual feedback ──────────────────────────────
  const triggerPacketDelivered = useCallback((pkt) => {
    pkt.status = 'DELIVERED';
    pkt.deliveredAt = Date.now();
    pkt.fadeStartAt = Date.now() + 4000;
    gatewayPulsesRef.current.push({
      id: `${pkt.packetId}-gw-${Date.now()}`,
      startTime: Date.now(),
      durationMs: 1800,
    });
  }, []);

  // ── Trigger packet dropped visual feedback ────────────────────────────────
  const triggerPacketDropped = useCallback((pkt, atNode) => {
    pkt.status = 'DROPPED';
    pkt.isDropped = true;
    pkt.droppedAt = Date.now();
    pkt.droppedCoord = getNodeCoord(atNode) || pkt.lastKnownCoord;
  }, [getNodeCoord]);

  // ── Main SOS packet animation rAF loop ────────────────────────────────────
  const startSosAnimationLoop = useCallback(() => {
    if (sosAnimationRef.current) return;

    const animateSos = () => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) {
        sosAnimationRef.current = requestAnimationFrame(animateSos);
        return;
      }

      const now = performance.now();
      const wallNow = Date.now();
      const packets = Array.from(trackedSosPacketsRef.current.values());

      let hasActiveWork = false;

      // 1. Process each tracked SOS packet
      packets.forEach((pkt) => {
        // A. Start next hop if currently idle and queue has pending hops
        if (!pkt.currentHop && pkt.hopQueue.length > 0) {
          const hop = pkt.hopQueue.shift();
          const fromCoord = pkt.lastKnownCoord || getNodeCoord(hop.from);
          const toCoord = getNodeCoord(hop.to);
          if (fromCoord && toCoord) {
            pkt.currentHop = {
              fromId: hop.from,
              toId: hop.to,
              fromCoord,
              toCoord,
              startTime: now,
              durationMs: hop.durationMs || HOP_DURATION_MS,
              progress: 0,
              currentCoord: fromCoord,
            };
          }
        }

        // B. Animate currently active hop
        if (pkt.currentHop) {
          hasActiveWork = true;
          const elapsed = now - pkt.currentHop.startTime;
          const rawT = Math.min(1, elapsed / pkt.currentHop.durationMs);
          const easedT = easeInOutCubic(rawT);

          const fromC = pkt.currentHop.fromCoord;
          const toC = pkt.currentHop.toCoord;

          const currLon = fromC[0] + (toC[0] - fromC[0]) * easedT;
          const currLat = fromC[1] + (toC[1] - fromC[1]) * easedT;
          pkt.currentHop.progress = easedT;
          pkt.currentHop.currentCoord = [currLon, currLat];
          pkt.lastKnownCoord = [currLon, currLat];

          if (rawT >= 1) {
            // Hop completed!
            pkt.completedCoords.push(toC);
            pkt.lastKnownCoord = toC;
            pkt.currentHop = null;

            // Check if packet reached final delivery or drop
            if (pkt.hopQueue.length === 0) {
              if (pkt.pendingDelivered) {
                triggerPacketDelivered(pkt);
              } else if (pkt.pendingDropped) {
                triggerPacketDropped(pkt, pkt.pendingDropped.atNode);
              }
            }
          }
        }

        // C. Delivered packet 4-second hold then 1-second fadeout
        if (pkt.status === 'DELIVERED') {
          if (pkt.fadeStartAt) {
            const timeSinceFadeStart = wallNow - pkt.fadeStartAt;
            if (timeSinceFadeStart < (pkt.fadeDurationMs || 1000)) {
              hasActiveWork = true;
            } else {
              trackedSosPacketsRef.current.delete(pkt.packetId);
            }
          } else {
            hasActiveWork = true;
          }
        }

        // D. Dropped packet 1.2-second fadeout
        if (pkt.isDropped) {
          if (wallNow - pkt.droppedAt < 1200) {
            hasActiveWork = true;
          } else {
            trackedSosPacketsRef.current.delete(pkt.packetId);
          }
        }

        // In-flight packets keep origin pulse ring active
        if (pkt.status === 'IN_FLIGHT') {
          hasActiveWork = true;
        }
      });

      // 2. Filter expired failed links
      failedSosLinksRef.current = failedSosLinksRef.current.filter((l) => {
        return wallNow - l.startTime < l.durationMs;
      });
      if (failedSosLinksRef.current.length > 0) hasActiveWork = true;

      // 3. Filter expired gateway pulses
      gatewayPulsesRef.current = gatewayPulsesRef.current.filter((p) => {
        return wallNow - p.startTime < p.durationMs;
      });
      if (gatewayPulsesRef.current.length > 0) hasActiveWork = true;

      // 4. Update Mapbox GeoJSON sources (travelled paths and failed links)
      const pathFeatures = [];
      Array.from(trackedSosPacketsRef.current.values()).forEach((pkt) => {
        const coords = [...pkt.completedCoords];
        if (pkt.currentHop) {
          coords.push(pkt.currentHop.currentCoord);
        }
        if (coords.length >= 2) {
          let opacity = 1.0;
          if (pkt.status === 'DELIVERED' && pkt.fadeStartAt && wallNow > pkt.fadeStartAt) {
            const fadeProg = (wallNow - pkt.fadeStartAt) / (pkt.fadeDurationMs || 1000);
            opacity = Math.max(0, 1 - fadeProg);
          } else if (pkt.isDropped) {
            const dropProg = Math.min(1, (wallNow - pkt.droppedAt) / 1200);
            opacity = Math.max(0, 0.7 * (1 - dropProg));
          }
          pathFeatures.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: coords,
            },
            properties: {
              packetId: pkt.packetId,
              opacity,
            },
          });
        }
      });

      const pathsSrc = map.getSource('sos-travelled-paths');
      if (pathsSrc) {
        pathsSrc.setData({
          type: 'FeatureCollection',
          features: pathFeatures,
        });
      }

      const failedFeatures = failedSosLinksRef.current.map((fl) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: fl.coords,
        },
        properties: {},
      }));

      const failedSrc = map.getSource('sos-failed-links');
      if (failedSrc) {
        failedSrc.setData({
          type: 'FeatureCollection',
          features: failedFeatures,
        });
      }

      // 5. Build Deck.gl animation layers data
      const originRings = [];
      const activeDots = [];
      const activeDotsGlow = [];
      const trails = [];
      const droppedDots = [];

      Array.from(trackedSosPacketsRef.current.values()).forEach((pkt) => {
        // Origin pulsing beacon ring in priority color until delivery
        if (pkt.status === 'IN_FLIGHT') {
          const originC = pkt.completedCoords[0];
          if (originC) {
            const pulsePhase = (wallNow % 1200) / 1200;
            const pColor = PRIORITY_COLORS[pkt.priority] || PRIORITY_COLORS[4];
            originRings.push({
              id: `orig-${pkt.packetId}`,
              lon: originC[0],
              lat: originC[1],
              radius: 14 + pulsePhase * 24,
              alpha: Math.floor((1 - pulsePhase) * 220),
              color: pColor,
            });
          }
        }

        // Active hopping glowing dot + soft glow + short fading trail
        if (pkt.currentHop) {
          const c = pkt.currentHop.currentCoord;
          activeDots.push({ id: `dot-${pkt.packetId}`, lon: c[0], lat: c[1] });
          activeDotsGlow.push({ id: `glow-${pkt.packetId}`, lon: c[0], lat: c[1] });

          const fromC = pkt.currentHop.fromCoord;
          const toC = pkt.currentHop.toCoord;
          const currentEasedT = pkt.currentHop.progress;
          const trailConfigs = [
            { dt: 0.05, radius: 9, alpha: 180 },
            { dt: 0.10, radius: 7, alpha: 130 },
            { dt: 0.15, radius: 5, alpha: 80 },
            { dt: 0.20, radius: 3.5, alpha: 40 },
          ];

          trailConfigs.forEach((cfg, idx) => {
            const tT = Math.max(0, currentEasedT - cfg.dt);
            const tLon = fromC[0] + (toC[0] - fromC[0]) * tT;
            const tLat = fromC[1] + (toC[1] - fromC[1]) * tT;
            trails.push({
              id: `trail-${pkt.packetId}-${idx}`,
              lon: tLon,
              lat: tLat,
              radius: cfg.radius,
              alpha: cfg.alpha,
            });
          });
        }

        // Dropped fading red dot
        if (pkt.isDropped && pkt.droppedCoord) {
          const dropT = Math.min(1, (wallNow - pkt.droppedAt) / 1200);
          droppedDots.push({
            id: `drop-${pkt.packetId}`,
            lon: pkt.droppedCoord[0],
            lat: pkt.droppedCoord[1],
            radius: 12 + dropT * 18,
            alpha: Math.floor((1 - dropT) * 255),
          });
        }
      });

      // Gateway delivery emerald pulses
      const gwRings = [];
      const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKmRef.current) || 4)) * 1000;
      const defaultGateway = offsetToGps(centerLatRef.current, centerLonRef.current, 0, -sideM / 2);
      const currentGw = gatewayRef.current || defaultGateway;

      gatewayPulsesRef.current.forEach((gp) => {
        const t = Math.min(1, (wallNow - gp.startTime) / gp.durationMs);
        gwRings.push({
          id: gp.id,
          lon: currentGw.lon,
          lat: currentGw.lat,
          radius: 14 + t * 44,
          alpha: Math.floor((1 - t) * 240),
        });
      });

      sosAnimDataRef.current = {
        originRings,
        gatewayPulses: gwRings,
        activeDots,
        activeDotsGlow,
        trails,
        droppedDots,
      };

      // Push updated layers to Deck.gl overlay
      renderDeckLayers(activeDronesRef.current, sosAnimDataRef.current);

      if (hasActiveWork) {
        sosAnimationRef.current = requestAnimationFrame(animateSos);
      } else {
        sosAnimationRef.current = null;
      }
    };

    sosAnimationRef.current = requestAnimationFrame(animateSos);
  }, [getNodeCoord, renderDeckLayers, triggerPacketDelivered, triggerPacketDropped]);

  // ── Subscribe to real-time mesh events for SOS packet telemetry ───────────
  useEffect(() => {
    const unsubEmergency = subscribe('EMERGENCY_CREATED', (ev) => {
      const pid = ev.packet_id || ev.packetId;
      if (!pid) return;
      const originCoord = getNodeCoord(ev.source);
      if (!originCoord) return;

      trackedSosPacketsRef.current.set(pid, {
        packetId: pid,
        source: normalizeNodeId(ev.source),
        code: (ev.code || 'MED').toUpperCase(),
        priority: ev.priority ?? 1,
        status: 'IN_FLIGHT',
        hopQueue: [],
        currentHop: null,
        lastKnownCoord: originCoord,
        completedCoords: [originCoord],
        deliveredAt: null,
        fadeStartAt: null,
        fadeDurationMs: 1000,
        isDropped: false,
        droppedAt: null,
        droppedCoord: null,
        pendingDelivered: false,
        pendingDropped: null,
      });

      startSosAnimationLoop();
    });

    const unsubForwarded = subscribe('PACKET_FORWARDED', (ev) => {
      const pid = ev.packet_id || ev.packetId;
      if (!pid) return;
      const pkt = trackedSosPacketsRef.current.get(pid);
      if (!pkt) return; // Only animate packets announced by EMERGENCY_CREATED

      const fromId = normalizeNodeId(ev.from);
      const toId = normalizeNodeId(ev.to);
      pkt.hopQueue.push({ from: fromId, to: toId, durationMs: HOP_DURATION_MS });

      startSosAnimationLoop();
    });

    const unsubRerouted = subscribe('PACKET_REROUTED', (ev) => {
      const pid = ev.packet_id || ev.packetId;
      if (!pid) return;
      const pkt = trackedSosPacketsRef.current.get(pid);
      if (!pkt) return;

      const atNodeId = normalizeNodeId(ev.at_node);
      const failedHopId = normalizeNodeId(ev.failed_next_hop);
      const c1 = getNodeCoord(atNodeId);
      const c2 = getNodeCoord(failedHopId);

      if (c1 && c2) {
        failedSosLinksRef.current.push({
          id: `${pid}-${Date.now()}`,
          fromId: atNodeId,
          toId: failedHopId,
          coords: [c1, c2],
          startTime: Date.now(),
          durationMs: 2500,
        });
      }

      startSosAnimationLoop();
    });

    const unsubDelivered = subscribe('PACKET_DELIVERED', (ev) => {
      const pid = ev.packet_id || ev.packetId;
      if (!pid) return;
      const pkt = trackedSosPacketsRef.current.get(pid);
      if (!pkt) return;

      pkt.pendingDelivered = true;
      if (!pkt.currentHop && pkt.hopQueue.length === 0) {
        triggerPacketDelivered(pkt);
      }

      startSosAnimationLoop();
    });

    const unsubDropped = subscribe('PACKET_DROPPED', (ev) => {
      const pid = ev.packet_id || ev.packetId;
      if (!pid) return;
      const pkt = trackedSosPacketsRef.current.get(pid);
      if (!pkt) return;

      pkt.pendingDropped = { atNode: normalizeNodeId(ev.at_node) };
      if (!pkt.currentHop && pkt.hopQueue.length === 0) {
        triggerPacketDropped(pkt, pkt.pendingDropped.atNode);
      }

      startSosAnimationLoop();
    });

    const handleReset = () => {
      trackedSosPacketsRef.current.clear();
      failedSosLinksRef.current = [];
      gatewayPulsesRef.current = [];
      sosAnimDataRef.current = {
        originRings: [],
        gatewayPulses: [],
        activeDots: [],
        activeDotsGlow: [],
        trails: [],
        droppedDots: [],
      };
      if (sosAnimationRef.current) {
        cancelAnimationFrame(sosAnimationRef.current);
        sosAnimationRef.current = null;
      }
      const map = mapRef.current;
      if (map) {
        const pSrc = map.getSource('sos-travelled-paths');
        if (pSrc) pSrc.setData({ type: 'FeatureCollection', features: [] });
        const fSrc = map.getSource('sos-failed-links');
        if (fSrc) fSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      renderDeckLayers();
    };

    window.addEventListener('sos:reset', handleReset);

    return () => {
      unsubEmergency();
      unsubForwarded();
      unsubRerouted();
      unsubDelivered();
      unsubDropped();
      window.removeEventListener('sos:reset', handleReset);
    };
  }, [getNodeCoord, startSosAnimationLoop, triggerPacketDelivered, triggerPacketDropped, renderDeckLayers]);

  // ── Focus camera on specific node ─────────────────────────────────────────
  const handleFlyToNode = useCallback((nodeId) => {
    const map = mapRef.current;
    if (!map) return;
    const norm = normalizeNodeId(nodeId);
    let coords = null;
    if (norm === 'GATEWAY') {
      const sideM = Math.sqrt(Math.max(0.1, Number(areaSqKmRef.current) || 4)) * 1000;
      const defaultGateway = offsetToGps(centerLatRef.current, centerLonRef.current, 0, -sideM / 2);
      const gw = gatewayRef.current || defaultGateway;
      coords = [gw.lon, gw.lat];
    } else {
      const n = nodesRef.current.find((item) => normalizeNodeId(item.id) === norm);
      if (n) coords = [n.lon, n.lat];
    }
    if (coords) {
      map.flyTo({
        center: coords,
        zoom: 15.5,
        duration: 1400,
        essential: true,
      });
    }
  }, []);

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

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut();
  }, []);

  useImperativeHandle(ref, () => ({
    toggle3D: handleToggle3D,
    focusArea: handleFocusArea,
    resetNorth: handleResetNorth,
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    flyToNode: handleFlyToNode,
    is3DMode,
  }), [handleToggle3D, handleFocusArea, handleResetNorth, handleZoomIn, handleZoomOut, handleFlyToNode, is3DMode]);

  // ── Render container ─────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      />
    </div>
  );
});

export default Map3DView;
