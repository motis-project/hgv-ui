import * as React from "react";
import polyline from "@mapbox/polyline";
import {
  client,
  initial,
  plan,
  type Itinerary,
  type Mode,
  type PlanData,
} from "@motis-project/motis-client";
import {
  Bug,
  ExternalLink,
  LocateFixed,
  Moon,
  Route,
  Share2,
  Sun,
  Truck,
  X,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Position,
} from "geojson";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { getStyle } from "@/lib/map/style";

type Theme = "dark" | "light";
type RouteMode = Extract<Mode, "CAR" | "HGV">;
type LngLat = { lng: number; lat: number };

type HgvParams = {
  height: number;
  width: number;
  length: number;
  weight: number;
  axleCount: number;
  axleLoad: number;
  topSpeed: number;
  hazmat: boolean;
  hazmatWater: boolean;
  trailer: boolean;
};

type RouteResult = {
  mode: RouteMode;
  duration: number;
  distance?: number;
  itinerary: Itinerary;
};

type RouteFeatureProperties = {
  mode: RouteMode;
  color: string;
  outlineColor: string;
};

type GraphFeatureProperties = Record<string, unknown> & {
  type?: string;
  has_hgv_info?: boolean;
  has_conditionals?: boolean;
  label?: string;
  osm_node_id?: number;
  osm_way_id?: number;
};

type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; message: string };

type ContextMenuState = {
  point: { x: number; y: number };
  lngLat: LngLat;
};

type MapView = {
  center: LngLat;
  zoom: number;
  bounds: { west: number; south: number; east: number; north: number };
};

const routeColors: Record<RouteMode, { color: string; outlineColor: string }> =
  {
    HGV: { color: "#06b6d4", outlineColor: "#164e63" },
    CAR: { color: "#7c3aed", outlineColor: "#4c1d95" },
  };
const routeModes = ["HGV", "CAR"] as const;
const graphLayerIds = [
  "hgv-graph-geometry-conditionals-glow",
  "hgv-graph-geometry",
  "hgv-graph-edge-conditionals-glow",
  "hgv-graph-edge",
  "hgv-graph-node",
  "hgv-graph-hgv-forbidden-icon",
  "hgv-graph-hazmat-forbidden-icon",
] as const;
const graphPaddingFactor = 0.35;
const graphFetchLevel = 0;
const graphTruckForbiddenIcon = "hgv-graph-truck-forbidden";
const graphHazmatForbiddenIcon = "hgv-graph-hazmat-forbidden";
const emptyGraphData: FeatureCollection<Geometry, GraphFeatureProperties> = {
  type: "FeatureCollection",
  features: [],
};

type LucideSpriteNode =
  | ["path", { d: string }]
  | ["circle", { cx: string; cy: string; r: string }];

const truckIconNode: LucideSpriteNode[] = [
  ["path", { d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" }],
  ["path", { d: "M15 18H9" }],
  [
    "path",
    {
      d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",
    },
  ],
  ["circle", { cx: "17", cy: "18", r: "2" }],
  ["circle", { cx: "7", cy: "18", r: "2" }],
];

const biohazardIconNode: LucideSpriteNode[] = [
  ["circle", { cx: "12", cy: "11.9", r: "2" }],
  ["path", { d: "M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6" }],
  ["path", { d: "m8.9 10.1 1.4.8" }],
  ["path", { d: "M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5" }],
  ["path", { d: "m15.1 10.1-1.4.8" }],
  ["path", { d: "M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2" }],
  ["path", { d: "M12 13.9v1.6" }],
  ["path", { d: "M13.5 5.4c-1-.2-2-.2-3 0" }],
  ["path", { d: "M17 16.4c.7-.7 1.2-1.6 1.5-2.5" }],
  ["path", { d: "M5.5 13.9c.3.9.8 1.8 1.5 2.5" }],
];

const defaultHgvParams: HgvParams = {
  height: 4.0,
  width: 2.55,
  length: 18.75,
  weight: 40.0,
  axleCount: 5,
  axleLoad: 11.5,
  topSpeed: 80,
  hazmat: false,
  hazmatWater: false,
  trailer: true,
};

const initialStart: LngLat = { lng: 6.771687, lat: 51.219075 };
// const initialStart: LngLat = { lng: 6.779465, lat: 51.218863 };
//const initialStart: LngLat = { lng: 8.6821, lat: 50.1109 };
const initialDestination: LngLat = { lng: 6.776556, lat: 51.230689 };
// const initialDestination: LngLat = { lng: 6.775689, lat: 51.238369 };
// const initialDestination: LngLat = { lng: 8.7654, lat: 50.1277 };
const motisBase = resolveMotisBase();
const querySerializer = { array: { explode: false, style: "form" as const } };

client.setConfig({ baseUrl: motisBase, querySerializer });

function resolveMotisBase() {
  const params = new URL(window.location.href).searchParams;
  const motisParam = params.get("motis");

  if (!motisParam) {
    return "http://localhost:8080";
  }

  const defaultProtocol = window.location.protocol;
  const defaultHost = window.location.hostname;
  const defaultPort = "8080";

  if (/^[0-9]+$/.test(motisParam)) {
    return `${defaultProtocol}//${defaultHost}:${motisParam}`;
  }

  if (!motisParam.includes(":")) {
    return `${defaultProtocol}//${motisParam}:${defaultPort}`;
  }

  if (!motisParam.startsWith("http:") && !motisParam.startsWith("https:")) {
    return `${defaultProtocol}//${motisParam}`;
  }

  return motisParam.replace(/\/$/, "");
}

function apiBaseWithSlash() {
  return motisBase.endsWith("/") ? motisBase : `${motisBase}/`;
}

function staticBaseForStyle() {
  const base = `${window.location.origin}${window.location.pathname}`;
  return base.endsWith("/") ? base : `${base}/`;
}

function getSystemThemeSnapshot(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeToSystemTheme(onChange: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", onChange);

  return () => mediaQuery.removeEventListener("change", onChange);
}

function placeToString(pos: LngLat) {
  return `${pos.lat.toFixed(7)},${pos.lng.toFixed(7)}`;
}

function formatCoord(value: number) {
  return value.toFixed(6);
}

function formatDuration(seconds: number | undefined) {
  if (seconds === undefined) {
    return "not found";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

function formatDistance(meters: number | undefined) {
  if (meters === undefined) {
    return "";
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function decodeRoute(itinerary: Itinerary): Position[] {
  const coords: Position[] = [];

  for (const leg of itinerary.legs) {
    const stepCoords = leg.steps?.flatMap((step) =>
      decodePolyline(step.polyline.points, step.polyline.precision),
    );

    if (stepCoords?.length) {
      coords.push(...stepCoords);
      continue;
    }

    if (leg.legGeometry.points) {
      coords.push(
        ...decodePolyline(leg.legGeometry.points, leg.legGeometry.precision),
      );
    }
  }

  return coords;
}

function decodePolyline(points: string, precision: number): Position[] {
  return polyline.decode(points, precision).map(([lat, lng]) => [lng, lat]);
}

function getRouteMode(itinerary: Itinerary): RouteMode | null {
  const mode = itinerary.legs.find(
    (leg) => leg.mode === "HGV" || leg.mode === "CAR",
  )?.mode;
  return mode === "HGV" || mode === "CAR" ? mode : null;
}

function routeDistance(itinerary: Itinerary) {
  const distances = itinerary.legs
    .map((leg) => leg.distance)
    .filter((value) => value !== undefined);
  if (!distances.length) {
    return undefined;
  }

  return distances.reduce((sum, value) => sum + value, 0);
}

function routesToGeoJson(
  routes: RouteResult[],
  visibleRoutes: Record<RouteMode, boolean>,
): FeatureCollection<LineString, RouteFeatureProperties> {
  const features: Array<Feature<LineString, RouteFeatureProperties>> = [];

  for (const routeResult of routes) {
    if (!visibleRoutes[routeResult.mode]) {
      continue;
    }

    const coordinates = decodeRoute(routeResult.itinerary);
    if (coordinates.length < 2) {
      continue;
    }

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        mode: routeResult.mode,
        ...routeColors[routeResult.mode],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function syncRouteLayers(
  map: maplibregl.Map,
  data: FeatureCollection<LineString, RouteFeatureProperties>,
) {
  if (!map.isStyleLoaded()) {
    return;
  }

  const source = map.getSource("hgv-routes") as
    | maplibregl.GeoJSONSource
    | undefined;
  if (source) {
    source.setData(data);
  } else {
    map.addSource("hgv-routes", { type: "geojson", data });
  }

  if (!map.getLayer("hgv-routes-outline")) {
    map.addLayer({
      id: "hgv-routes-outline",
      type: "line",
      source: "hgv-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "outlineColor"],
        "line-width": 10,
        "line-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("hgv-routes-line")) {
    map.addLayer({
      id: "hgv-routes-line",
      type: "line",
      source: "hgv-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6,
        "line-opacity": 0.96,
      },
    });
  }

  if (!map.getLayer("hgv-routes-label")) {
    map.addLayer({
      id: "hgv-routes-label",
      type: "symbol",
      source: "hgv-routes",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 240,
        "text-field": ["get", "mode"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": ["get", "outlineColor"],
        "text-halo-width": 2,
      },
    });
  }
}

function syncRouteLayersWhenReady(
  map: maplibregl.Map,
  getData: () => FeatureCollection<LineString, RouteFeatureProperties>,
) {
  const sync = () => {
    if (map.isStyleLoaded()) {
      syncRouteLayers(map, getData());
      return;
    }

    map.once("idle", sync);
  };

  sync();
}

function createLucideSpriteImage(iconNode: LucideSpriteNode[], color: string) {
  const size = 44;
  const padding = 8;
  const scale = (size - padding * 2) / 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new ImageData(size, size);
  }

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(17, 24, 39, 0.32)";
  ctx.stroke();

  ctx.save();
  ctx.translate(padding, padding);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = color;
  ctx.fillStyle = "transparent";

  for (const [tag, attrs] of iconNode) {
    if (tag === "path") {
      ctx.stroke(new Path2D(attrs.d));
      continue;
    }

    ctx.beginPath();
    ctx.arc(
      Number(attrs.cx),
      Number(attrs.cy),
      Number(attrs.r),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

function ensureGraphSprites(map: maplibregl.Map) {
  if (!map.hasImage(graphTruckForbiddenIcon)) {
    map.addImage(
      graphTruckForbiddenIcon,
      createLucideSpriteImage(truckIconNode, "#dc2626"),
      { pixelRatio: 2 },
    );
  }

  if (!map.hasImage(graphHazmatForbiddenIcon)) {
    map.addImage(
      graphHazmatForbiddenIcon,
      createLucideSpriteImage(biohazardIconNode, "#d97706"),
      { pixelRatio: 2 },
    );
  }
}

function syncGraphLayers(
  map: maplibregl.Map,
  data: FeatureCollection<Geometry, GraphFeatureProperties>,
) {
  if (!map.isStyleLoaded()) {
    return;
  }

  const source = map.getSource("hgv-graph") as
    | maplibregl.GeoJSONSource
    | undefined;
  if (source) {
    source.setData(data);
  } else {
    map.addSource("hgv-graph", { type: "geojson", data });
  }
  ensureGraphSprites(map);

  const beforeLayerId = map.getLayer("hgv-routes-outline")
    ? "hgv-routes-outline"
    : undefined;
  const graphGeometryColor: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["get", "has_hgv_info"], false],
    "#22d3ee",
    "#e55e5e",
  ];
  const graphEdgeColor: maplibregl.ExpressionSpecification = [
    "case",
    ["boolean", ["get", "has_hgv_info"], false],
    "#2563eb",
    "#a300d9",
  ];
  const graphConditionalFilter: maplibregl.FilterSpecification = [
    "==",
    ["get", "has_conditionals"],
    true,
  ];

  if (!map.getLayer("hgv-graph-geometry-conditionals-glow")) {
    map.addLayer(
      {
        id: "hgv-graph-geometry-conditionals-glow",
        type: "line",
        source: "hgv-graph",
        filter: [
          "all",
          ["==", ["get", "type"], "geometry"],
          graphConditionalFilter,
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#facc15",
          "line-width": 10,
          "line-blur": 3,
          "line-opacity": 0.55,
        },
      },
      beforeLayerId,
    );
  }

  if (!map.getLayer("hgv-graph-geometry")) {
    map.addLayer(
      {
        id: "hgv-graph-geometry",
        type: "line",
        source: "hgv-graph",
        filter: ["==", ["get", "type"], "geometry"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": graphGeometryColor,
          "line-width": 3,
          "line-opacity": 0.65,
        },
      },
      beforeLayerId,
    );
  }

  if (!map.getLayer("hgv-graph-edge-conditionals-glow")) {
    map.addLayer(
      {
        id: "hgv-graph-edge-conditionals-glow",
        type: "line",
        source: "hgv-graph",
        filter: [
          "all",
          ["==", ["get", "type"], "edge"],
          graphConditionalFilter,
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#facc15",
          "line-width": 18,
          "line-blur": 2.5,
          "line-opacity": 0.6,
        },
      },
      beforeLayerId,
    );
  }

  if (!map.getLayer("hgv-graph-edge")) {
    map.addLayer(
      {
        id: "hgv-graph-edge",
        type: "line",
        source: "hgv-graph",
        filter: ["==", ["get", "type"], "edge"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": graphEdgeColor,
          "line-width": 2.25,
          "line-opacity": 0.95,
        },
      },
      beforeLayerId,
    );
  }

  if (!map.getLayer("hgv-graph-node")) {
    map.addLayer(
      {
        id: "hgv-graph-node",
        type: "circle",
        source: "hgv-graph",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": [
            "case",
            ["!=", ["get", "restrictions"], "[]"],
            "#eab308",
            ["==", ["get", "label"], "unreachable"],
            "#ef4444",
            "#10b981",
          ],
          "circle-radius": 4.5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
        },
      },
      beforeLayerId,
    );
  }

  if (!map.getLayer("hgv-graph-hgv-forbidden-icon")) {
    map.addLayer({
      id: "hgv-graph-hgv-forbidden-icon",
      type: "symbol",
      source: "hgv-graph",
      filter: [
        "all",
        ["==", ["get", "type"], "edge"],
        ["==", ["get", "hgv_access"], "forbidden"],
      ],
      layout: {
        "symbol-placement": "line-center",
        "icon-image": graphTruckForbiddenIcon,
        "icon-size": 1,
        "icon-offset": [0, -1.25],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
      },
    });
  }

  if (!map.getLayer("hgv-graph-hazmat-forbidden-icon")) {
    map.addLayer({
      id: "hgv-graph-hazmat-forbidden-icon",
      type: "symbol",
      source: "hgv-graph",
      filter: [
        "all",
        ["==", ["get", "type"], "edge"],
        ["==", ["get", "hazmat_access"], "forbidden"],
      ],
      layout: {
        "symbol-placement": "line-center",
        "icon-image": graphHazmatForbiddenIcon,
        "icon-size": 1,
        "icon-offset": [0, 1.25],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
      },
    });
  }
}

function syncGraphLayersWhenReady(
  map: maplibregl.Map,
  getData: () => FeatureCollection<Geometry, GraphFeatureProperties>,
) {
  const sync = () => {
    if (map.isStyleLoaded()) {
      syncGraphLayers(map, getData());
      return;
    }

    map.once("idle", sync);
  };

  sync();
}

function fitRoutes(
  map: maplibregl.Map,
  routes: RouteResult[],
  start: LngLat,
  destination: LngLat,
) {
  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([start.lng, start.lat]);
  bounds.extend([destination.lng, destination.lat]);

  for (const routeResult of routes) {
    for (const coord of decodeRoute(routeResult.itinerary)) {
      bounds.extend(coord as [number, number]);
    }
  }

  map.fitBounds(bounds, {
    padding: { top: 72, right: 72, bottom: 72, left: 400 },
    maxZoom: 16,
  });
}

function createMarkerElement(label: string, color: string) {
  const host = document.createElement("div");
  host.className = "hgv-marker-host";

  const pin = document.createElement("div");
  pin.className = "hgv-marker";
  pin.style.setProperty("--marker-color", color);

  const text = document.createElement("span");
  text.textContent = label;

  pin.append(text);
  host.append(pin);
  return host;
}

function ensureMarker(
  map: maplibregl.Map,
  markerRef: React.RefObject<maplibregl.Marker | null>,
  lngLat: LngLat,
  label: string,
  color: string,
  onDragEnd: (lngLat: LngLat) => void,
) {
  let marker = markerRef.current;

  if (!marker) {
    marker = new maplibregl.Marker({
      draggable: true,
      anchor: "bottom",
      element: createMarkerElement(label, color),
    });
    marker.on("dragend", () => {
      const next = marker?.getLngLat();
      if (next) {
        onDragEnd({ lng: next.lng, lat: next.lat });
      }
    });
    markerRef.current = marker;
  }

  const markerElement = marker.getElement();
  const currentLngLat = marker.getLngLat();
  if (
    !currentLngLat ||
    currentLngLat.lng !== lngLat.lng ||
    currentLngLat.lat !== lngLat.lat
  ) {
    marker.setLngLat([lngLat.lng, lngLat.lat]);
  }

  if (
    !markerElement.isConnected ||
    markerElement.parentElement !== map.getCanvasContainer()
  ) {
    marker.addTo(map);
  }
}

function getMapView(map: maplibregl.Map): MapView {
  const center = map.getCenter();
  const bounds = map.getBounds();

  return {
    center: { lng: center.lng, lat: center.lat },
    zoom: map.getZoom(),
    bounds: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatGraphPropertyValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function splitTopLevelEntries(value: string) {
  const entries: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < value.length; ++i) {
    const char = value[i];

    switch (char) {
      case "(":
        ++parenDepth;
        current += char;
        break;
      case ")":
        parenDepth = Math.max(0, parenDepth - 1);
        current += char;
        break;
      case "[":
        ++bracketDepth;
        current += char;
        break;
      case "]":
        bracketDepth = Math.max(0, bracketDepth - 1);
        current += char;
        break;
      case "{":
        ++braceDepth;
        current += char;
        break;
      case "}":
        braceDepth = Math.max(0, braceDepth - 1);
        current += char;
        break;
      case ",":
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          const entry = current.trim();
          if (entry.length > 0) {
            entries.push(entry);
          }
          current = "";
        } else {
          current += char;
        }
        break;
      default:
        current += char;
        break;
    }
  }

  const tail = current.trim();
  if (tail.length > 0) {
    entries.push(tail);
  }

  return entries;
}

function parseRestrictionEntries(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }

  return splitTopLevelEntries(inner);
}

function splitRestrictionCondition(entry: string) {
  let parenDepth = 0;

  for (let i = 0; i < entry.length - 2; ++i) {
    const char = entry[i];
    if (char === "(") {
      ++parenDepth;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }

    if (parenDepth === 0 && entry.slice(i, i + 3) === " @ ") {
      return {
        restriction: entry.slice(0, i).trim(),
        condition: entry.slice(i + 3).trim(),
      };
    }
  }

  return { restriction: entry.trim(), condition: null };
}

function appendRestrictionList(container: HTMLElement, value: string) {
  const entries = parseRestrictionEntries(value);
  if (entries === null) {
    container.textContent = value;
    return;
  }

  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "graph-debug-popup__empty";
    empty.textContent = "[]";
    container.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "graph-debug-popup__restrictions";

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "graph-debug-popup__restriction";

    const { restriction, condition } = splitRestrictionCondition(entry);

    const main = document.createElement("div");
    main.className = "graph-debug-popup__restriction-main";
    main.textContent = restriction;
    row.append(main);

    if (condition) {
      const meta = document.createElement("div");
      meta.className = "graph-debug-popup__restriction-condition";
      meta.textContent = `@ ${condition}`;
      row.append(meta);
    }

    list.append(row);
  }

  container.append(list);
}

function createGraphPopupContent(properties: GraphFeatureProperties) {
  const container = document.createElement("div");
  container.className = "graph-debug-popup";

  const table = document.createElement("table");
  table.className = "graph-debug-popup__table";
  const body = document.createElement("tbody");

  for (const [key, value] of Object.entries(properties)) {
    const row = document.createElement("tr");

    const keyCell = document.createElement("th");
    keyCell.textContent = key;

    const valueCell = document.createElement("td");
    if (key === "osm_node_id" && value !== undefined) {
      const link = document.createElement("a");
      link.href = `https://www.openstreetmap.org/node/${String(value)}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = String(value);
      valueCell.append(link);
    } else if (key === "osm_way_id" && value !== undefined) {
      const link = document.createElement("a");
      link.href = `https://www.openstreetmap.org/way/${String(value)}`;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = String(value);
      valueCell.append(link);
    } else if (key === "restrictions" && typeof value === "string") {
      appendRestrictionList(valueCell, value);
    } else if (typeof value === "boolean") {
      const booleanValue = document.createElement("span");
      booleanValue.className = `graph-debug-popup__boolean graph-debug-popup__boolean--${value ? "true" : "false"}`;
      booleanValue.textContent = String(value);
      valueCell.append(booleanValue);
    } else {
      valueCell.textContent = formatGraphPropertyValue(value);
    }

    row.append(keyCell, valueCell);
    body.append(row);
  }

  table.append(body);
  container.append(table);
  return container;
}

function expandBounds(
  bounds: maplibregl.LngLatBounds,
  factor = graphPaddingFactor,
) {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const lngPadding = Math.max(Math.abs(east - west) * factor, 0.002);
  const latPadding = Math.max(Math.abs(north - south) * factor, 0.002);

  return new maplibregl.LngLatBounds(
    [west - lngPadding, Math.max(-85, south - latPadding)],
    [east + lngPadding, Math.min(85, north + latPadding)],
  );
}

function boundsContainBounds(
  outer: maplibregl.LngLatBounds,
  inner: maplibregl.LngLatBounds,
) {
  return [
    inner.getSouthWest(),
    inner.getNorthEast(),
    { lng: inner.getWest(), lat: inner.getNorth() },
    { lng: inner.getEast(), lat: inner.getSouth() },
  ].every((point) => outer.contains(point));
}

async function fetchGraphData(bounds: maplibregl.LngLatBounds) {
  const response = await fetch(`${motisBase}/api/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level: graphFetchLevel,
      waypoints: bounds.toArray().flat(),
    }),
  });
  const raw = await response.text();
  let parsed: unknown = null;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const message =
      isRecord(parsed) && typeof parsed.message === "string"
        ? parsed.message
        : raw.trim() || `graph request failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (
    (parsed as FeatureCollection<Geometry, GraphFeatureProperties>) ??
    emptyGraphData
  );
}

function getGraphErrorStatus(error: unknown) {
  return isRecord(error) && typeof error.status === "number"
    ? error.status
    : undefined;
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function sendJosmRemoteControl(url: string) {
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  image.src = url;
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[11px] font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
      <input
        className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
        min={min}
        step={step ?? 1}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
      />
    </label>
  );
}

function DateTimeField({
  label,
  hint,
  value,
  onChange,
  onClear,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[11px] font-medium text-muted-foreground">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate">{label}</span>
        {hint ? (
          <span className="text-[10px] text-muted-foreground/80">{hint}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <input
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
          type="datetime-local"
          step={60}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          title="Clear date and time"
          disabled={!value}
          onClick={onClear}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </label>
  );
}

function CoordinateFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LngLat;
  onChange: (value: LngLat) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="lat"
          step={0.000001}
          value={Number(formatCoord(value.lat))}
          onChange={(lat) => onChange({ ...value, lat })}
        />
        <NumberField
          label="lon"
          step={0.000001}
          value={Number(formatCoord(value.lng))}
          onChange={(lng) => onChange({ ...value, lng })}
        />
      </div>
    </fieldset>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
      <input
        className="size-4 rounded border-input accent-primary"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function formatTimeZoneOffset(minutes: number) {
  const sign = minutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const remainingMinutes = absMinutes % 60;
  return `${sign}${hours.toString().padStart(2, "0")}:${remainingMinutes
    .toString()
    .padStart(2, "0")}`;
}

function toLocalIsoDateTime(value: string) {
  if (!value) {
    return undefined;
  }

  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(withSeconds);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return `${withSeconds}${formatTimeZoneOffset(-parsed.getTimezoneOffset())}`;
}

function App() {
  const { theme, setTheme } = useTheme();
  const systemTheme = React.useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    getSystemThemeSnapshot,
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const [start, setStart] = React.useState<LngLat>(initialStart);
  const [destination, setDestination] =
    React.useState<LngLat>(initialDestination);
  const [hgvParams, setHgvParams] = React.useState<HgvParams>(defaultHgvParams);
  const [routingTime, setRoutingTime] = React.useState("");
  const [maxDurationMinutes, setMaxDurationMinutes] = React.useState(30);
  const [routes, setRoutes] = React.useState<RouteResult[]>([]);
  const [activeProfiles, setActiveProfiles] = React.useState<
    Record<RouteMode, boolean>
  >({ HGV: true, CAR: true });
  const [visibleRoutes, setVisibleRoutes] = React.useState<
    Record<RouteMode, boolean>
  >({ HGV: true, CAR: true });
  const [graphDebugEnabled, setGraphDebugEnabled] = React.useState(false);
  const [requestState, setRequestState] = React.useState<RequestState>({
    status: "idle",
  });
  const [graphRequestState, setGraphRequestState] =
    React.useState<RequestState>({ status: "idle" });
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(
    null,
  );

  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const initialMapThemeRef = React.useRef(resolvedTheme);
  const mapThemeRef = React.useRef<Theme>(resolvedTheme);
  const startMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const destinationMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const latestStartRef = React.useRef(start);
  const latestDestinationRef = React.useRef(destination);
  const latestRouteDataRef = React.useRef<
    FeatureCollection<LineString, RouteFeatureProperties>
  >({
    type: "FeatureCollection",
    features: [],
  });
  const latestGraphDataRef = React.useRef(emptyGraphData);
  const graphDebugEnabledRef = React.useRef(graphDebugEnabled);
  const graphFetchBoundsRef = React.useRef<maplibregl.LngLatBounds | null>(
    null,
  );
  const graphRequestTokenRef = React.useRef(0);
  const graphPopupRef = React.useRef<maplibregl.Popup | null>(null);
  const requestTokenRef = React.useRef(0);

  const visibleRouteResults = React.useMemo(
    () => routes.filter((routeResult) => visibleRoutes[routeResult.mode]),
    [routes, visibleRoutes],
  );
  const routeData = React.useMemo(
    () => routesToGeoJson(routes, visibleRoutes),
    [routes, visibleRoutes],
  );

  React.useEffect(() => {
    latestStartRef.current = start;
  }, [start]);

  React.useEffect(() => {
    latestDestinationRef.current = destination;
  }, [destination]);

  const closeGraphPopup = React.useCallback(() => {
    graphPopupRef.current?.remove();
    graphPopupRef.current = null;
  }, []);

  const syncEndpointMarkers = React.useCallback((map: maplibregl.Map) => {
    ensureMarker(
      map,
      startMarkerRef,
      latestStartRef.current,
      "A",
      "#16a34a",
      setStart,
    );
    ensureMarker(
      map,
      destinationMarkerRef,
      latestDestinationRef.current,
      "B",
      "#dc2626",
      setDestination,
    );
  }, []);

  const openGraphPopup = React.useCallback(
    (feature: maplibregl.MapGeoJSONFeature, lngLat: maplibregl.LngLat) => {
      const map = mapRef.current;
      if (!map) {
        return;
      }

      closeGraphPopup();
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: "none",
        offset: 10,
      })
        .setLngLat(lngLat)
        .setDOMContent(
          createGraphPopupContent(
            isRecord(feature.properties)
              ? (feature.properties as GraphFeatureProperties)
              : {},
          ),
        )
        .addTo(map);

      popup.on("close", () => {
        if (graphPopupRef.current === popup) {
          graphPopupRef.current = null;
        }
      });
      graphPopupRef.current = popup;
    },
    [closeGraphPopup],
  );

  const ensureGraphCoverage = React.useCallback(
    async (map: maplibregl.Map, options?: { force?: boolean }) => {
      if (!graphDebugEnabledRef.current) {
        return;
      }

      const viewportBounds = map.getBounds();
      const cachedBounds = graphFetchBoundsRef.current;
      if (
        !options?.force &&
        cachedBounds &&
        boundsContainBounds(cachedBounds, viewportBounds)
      ) {
        syncGraphLayersWhenReady(map, () => latestGraphDataRef.current);
        return;
      }

      const expandedBounds = expandBounds(viewportBounds);
      const token = ++graphRequestTokenRef.current;
      closeGraphPopup();
      setGraphRequestState({ status: "loading" });

      try {
        let requestBounds = expandedBounds;
        let data: FeatureCollection<Geometry, GraphFeatureProperties>;

        try {
          data = await fetchGraphData(expandedBounds);
        } catch (error) {
          if (getGraphErrorStatus(error) !== 422) {
            throw error;
          }

          requestBounds = viewportBounds;
          data = await fetchGraphData(viewportBounds);
        }

        if (
          token !== graphRequestTokenRef.current ||
          mapRef.current !== map ||
          !graphDebugEnabledRef.current
        ) {
          return;
        }

        graphFetchBoundsRef.current = requestBounds;
        latestGraphDataRef.current = data;
        setGraphRequestState({ status: "ok" });
        syncGraphLayersWhenReady(map, () => latestGraphDataRef.current);
      } catch (error) {
        if (token !== graphRequestTokenRef.current || mapRef.current !== map) {
          return;
        }

        graphFetchBoundsRef.current = null;
        latestGraphDataRef.current = emptyGraphData;
        setGraphRequestState({
          status: "error",
          message:
            getGraphErrorStatus(error) === 422
              ? "graph debug overlay exceeded backend limits for this view"
              : error instanceof Error
                ? error.message
                : "graph request failed",
        });
        syncGraphLayersWhenReady(map, () => emptyGraphData);
      }
    },
    [closeGraphPopup],
  );

  React.useEffect(() => {
    graphDebugEnabledRef.current = graphDebugEnabled;
  }, [graphDebugEnabled]);

  React.useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) {
      return undefined;
    }

    const center: [number, number] = [
      (initialStart.lng + initialDestination.lng) / 2,
      (initialStart.lat + initialDestination.lat) / 2,
    ];
    const map = new maplibregl.Map({
      container,
      center,
      zoom: 12,
      pitchWithRotate: false,
      fadeDuration: 0,
      attributionControl: false,
      style: getStyle(
        initialMapThemeRef.current,
        0,
        staticBaseForStyle(),
        apiBaseWithSlash(),
        false,
      ),
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: false }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
      "bottom-left",
    );

    window.requestAnimationFrame(() => map.resize());

    const getGraphFeaturesAtPoint = (point: maplibregl.Point) => {
      const visibleGraphLayers = graphLayerIds.filter((layerId) =>
        Boolean(map.getLayer(layerId)),
      );
      if (!visibleGraphLayers.length) {
        return [];
      }

      return map.queryRenderedFeatures(point, {
        layers: [...visibleGraphLayers],
      }) as maplibregl.MapGeoJSONFeature[];
    };

    const sync = () => {
      syncEndpointMarkers(map);
      syncRouteLayersWhenReady(map, () => latestRouteDataRef.current);
      if (graphDebugEnabledRef.current) {
        syncGraphLayersWhenReady(map, () => latestGraphDataRef.current);
      }
    };
    map.on("load", sync);
    map.on("style.load", sync);
    map.on("styledata", sync);
    map.on("render", () => syncEndpointMarkers(map));
    map.on("moveend", () => {
      syncEndpointMarkers(map);
      if (graphDebugEnabledRef.current) {
        void ensureGraphCoverage(map);
      }
    });
    map.on("click", (event) => {
      setContextMenu(null);
      if (!graphDebugEnabledRef.current) {
        return;
      }

      const feature = getGraphFeaturesAtPoint(event.point)[0];
      if (!feature) {
        closeGraphPopup();
        return;
      }

      openGraphPopup(feature, event.lngLat);
    });
    map.on("mousemove", (event) => {
      if (!graphDebugEnabledRef.current) {
        map.getCanvas().style.cursor = "";
        return;
      }

      map.getCanvas().style.cursor = getGraphFeaturesAtPoint(event.point).length
        ? "pointer"
        : "";
    });
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      closeGraphPopup();
      const rect = container.getBoundingClientRect();
      const point = new maplibregl.Point(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      const lngLat = map.unproject(point);
      setContextMenu({
        point: { x: event.clientX, y: event.clientY },
        lngLat: { lng: lngLat.lng, lat: lngLat.lat },
      });
    };
    container.addEventListener("contextmenu", onContextMenu);

    initial().then((response) => {
      const data = response.data;
      if (!data || mapRef.current !== map) {
        return;
      }

      map.jumpTo({ center: [data.lon, data.lat], zoom: data.zoom });
      map.resize();
    });

    mapRef.current = map;
    syncEndpointMarkers(map);

    return () => {
      container.removeEventListener("contextmenu", onContextMenu);

      startMarkerRef.current?.remove();
      destinationMarkerRef.current?.remove();
      startMarkerRef.current = null;
      destinationMarkerRef.current = null;
      closeGraphPopup();

      map.remove();
      mapRef.current = null;
    };
  }, [
    closeGraphPopup,
    ensureGraphCoverage,
    openGraphPopup,
    syncEndpointMarkers,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || mapThemeRef.current === resolvedTheme) {
      return;
    }

    const nextStyle = getStyle(
      resolvedTheme,
      0,
      staticBaseForStyle(),
      apiBaseWithSlash(),
      false,
    );

    const applyStyle = () => {
      if (mapRef.current !== map) {
        return;
      }

      mapThemeRef.current = resolvedTheme;
      map.setStyle(nextStyle, { diff: false });
      syncRouteLayersWhenReady(map, () => latestRouteDataRef.current);
      if (graphDebugEnabledRef.current) {
        syncGraphLayersWhenReady(map, () => latestGraphDataRef.current);
      }
    };

    if (map.isStyleLoaded()) {
      applyStyle();
    } else {
      map.once("load", applyStyle);
    }
  }, [resolvedTheme]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map) {
      syncEndpointMarkers(map);
    }

    return undefined;
  }, [start, syncEndpointMarkers]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map) {
      syncEndpointMarkers(map);
    }

    return undefined;
  }, [destination, syncEndpointMarkers]);

  React.useEffect(() => {
    latestRouteDataRef.current = routeData;
    const map = mapRef.current;
    if (map) {
      syncRouteLayersWhenReady(map, () => routeData);
    }
  }, [routeData]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (!graphDebugEnabled) {
      graphRequestTokenRef.current += 1;
      graphFetchBoundsRef.current = null;
      latestGraphDataRef.current = emptyGraphData;
      setGraphRequestState({ status: "idle" });
      map.getCanvas().style.cursor = "";
      closeGraphPopup();
      syncGraphLayersWhenReady(map, () => emptyGraphData);
      return;
    }

    void ensureGraphCoverage(map, { force: true });
  }, [closeGraphPopup, ensureGraphCoverage, graphDebugEnabled]);

  React.useEffect(() => {
    const token = ++requestTokenRef.current;
    const timer = window.setTimeout(async () => {
      setRequestState({ status: "loading" });

      const query: PlanData["query"] = {
        fromPlace: placeToString(start),
        toPlace: placeToString(destination),
        transitModes: [],
        preTransitModes: [],
        postTransitModes: [],
        directModes: routeModes.filter((m) => activeProfiles[m]),
        maxDirectTime: maxDurationMinutes * 60,
        maxTravelTime: maxDurationMinutes,
        maxMatchingDistance: 250,
        timetableView: false,
        detailedLegs: true,
        detailedTransfers: true,
        withFares: false,
        vehicleHeight: hgvParams.height,
        vehicleWidth: hgvParams.width,
        vehicleLength: hgvParams.length,
        vehicleWeight: hgvParams.weight,
        vehicleHazmat: hgvParams.hazmat,
        vehicleHazmatWater: hgvParams.hazmatWater,
        vehicleAxleCount: hgvParams.axleCount,
        vehicleAxleLoad: hgvParams.axleLoad,
        vehicleTrailer: hgvParams.trailer,
        vehicleTopSpeed: hgvParams.topSpeed,
      };

      const isoTime = toLocalIsoDateTime(routingTime);
      if (isoTime) {
        query.time = isoTime;
      }

      try {
        const response = await plan({ query });
        if (token !== requestTokenRef.current) {
          return;
        }

        if (response.error || !response.data) {
          throw new Error(`HTTP ${response.response.status}`);
        }

        const nextRoutes = response.data.direct.reduce<RouteResult[]>(
          (foundRoutes, itinerary) => {
            const mode = getRouteMode(itinerary);
            if (
              !mode ||
              foundRoutes.some((routeResult) => routeResult.mode === mode)
            ) {
              return foundRoutes;
            }

            foundRoutes.push({
              mode,
              itinerary,
              duration: itinerary.duration,
              distance: routeDistance(itinerary),
            });
            return foundRoutes;
          },
          [],
        );

        setRoutes(nextRoutes);
        setRequestState({ status: "ok" });
      } catch (error) {
        if (token !== requestTokenRef.current) {
          return;
        }

        setRoutes([]);
        setRequestState({
          status: "error",
          message:
            error instanceof Error ? error.message : "routing request failed",
        });
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    activeProfiles,
    destination,
    hgvParams,
    maxDurationMinutes,
    routingTime,
    start,
  ]);

  const setHgvParam = React.useCallback(
    <Key extends keyof HgvParams>(key: Key, value: HgvParams[Key]) => {
      setHgvParams((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const routeByMode = React.useMemo(
    () => new Map(routes.map((routeResult) => [routeResult.mode, routeResult])),
    [routes],
  );

  const hasVisibleRoutes = visibleRouteResults.length > 0;
  const graphButtonTitle =
    graphRequestState.status === "error"
      ? `Graph debug overlay failed: ${graphRequestState.message}`
      : graphRequestState.status === "loading"
        ? "Graph debug overlay (loading)"
        : graphDebugEnabled
          ? "Hide graph debug overlay"
          : "Show graph debug overlay";

  const openInOpenStreetMap = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const view = getMapView(map);
    openExternalUrl(
      `https://www.openstreetmap.org/#map=${Math.round(view.zoom)}/${view.center.lat.toFixed(6)}/${view.center.lng.toFixed(6)}`,
    );
  }, []);

  const openInGoogleMaps = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const view = getMapView(map);
    openExternalUrl(
      `https://www.google.com/maps/@${view.center.lat.toFixed(6)},${view.center.lng.toFixed(6)},${Math.max(1, Math.round(view.zoom))}z`,
    );
  }, []);

  const openInJosm = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const view = getMapView(map);
    const params = new URLSearchParams({
      left: view.bounds.west.toFixed(7),
      right: view.bounds.east.toFixed(7),
      top: view.bounds.north.toFixed(7),
      bottom: view.bounds.south.toFixed(7),
    });
    sendJosmRemoteControl(`http://127.0.0.1:8111/load_and_zoom?${params}`);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <div
        ref={mapContainerRef}
        className="fixed inset-0 z-0 h-screen w-screen"
      />

      <aside className="fixed left-3 top-3 z-10 flex max-h-[calc(100dvh-1.5rem)] w-90 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-md border border-border/80 bg-background/95 p-3 text-sm shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Truck className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-sm font-semibold">HGV routing</h1>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="outline"
                    title="Open current map view"
                  />
                }
              >
                <Share2 className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 min-w-0">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Open map in</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="gap-3 whitespace-nowrap"
                    onClick={openInOpenStreetMap}
                  >
                    <span>OpenStreetMap.org</span>
                    <ExternalLink className="ml-auto size-3.5" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-3 whitespace-nowrap"
                    onClick={openInGoogleMaps}
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="ml-auto size-3.5" />
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="gap-3 whitespace-nowrap"
                    onClick={openInJosm}
                  >
                    <span>JOSM via Remote Control</span>
                    <ExternalLink className="ml-auto size-3.5" />
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="icon-sm"
              variant={
                graphRequestState.status === "error"
                  ? "destructive"
                  : graphDebugEnabled
                    ? "default"
                    : "outline"
              }
              title={graphButtonTitle}
              onClick={() => setGraphDebugEnabled((current) => !current)}
            >
              <Bug
                className={`size-4 ${graphRequestState.status === "loading" ? "animate-pulse" : ""}`}
              />
            </Button>

            <Button
              size="icon-sm"
              variant="outline"
              title="Toggle theme"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              {resolvedTheme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {motisBase}
        </div>

        <div className="grid gap-3">
          <CoordinateFields label="Start" value={start} onChange={setStart} />
          <CoordinateFields
            label="Destination"
            value={destination}
            onChange={setDestination}
          />
        </div>

        <div className="h-px bg-border" />

        <section className="grid gap-3">
          <DateTimeField
            label="date + time"
            value={routingTime}
            onChange={setRoutingTime}
            onClear={() => setRoutingTime("")}
          />

          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="height m"
              min={0}
              step={0.05}
              value={hgvParams.height}
              onChange={(value) => setHgvParam("height", value)}
            />
            <NumberField
              label="width m"
              min={0}
              step={0.05}
              value={hgvParams.width}
              onChange={(value) => setHgvParam("width", value)}
            />
            <NumberField
              label="length m"
              min={0}
              step={0.05}
              value={hgvParams.length}
              onChange={(value) => setHgvParam("length", value)}
            />
            <NumberField
              label="weight t"
              min={0}
              step={0.5}
              value={hgvParams.weight}
              onChange={(value) => setHgvParam("weight", value)}
            />
            <NumberField
              label="axles"
              min={1}
              step={1}
              value={hgvParams.axleCount}
              onChange={(value) => setHgvParam("axleCount", Math.round(value))}
            />
            <NumberField
              label="axle load t"
              min={0}
              step={0.5}
              value={hgvParams.axleLoad}
              onChange={(value) => setHgvParam("axleLoad", value)}
            />
            <NumberField
              label="top km/h"
              min={1}
              step={5}
              value={hgvParams.topSpeed}
              onChange={(value) => setHgvParam("topSpeed", Math.round(value))}
            />
            <NumberField
              label="max min"
              min={1}
              step={5}
              value={maxDurationMinutes}
              onChange={(value) =>
                setMaxDurationMinutes(Math.max(1, Math.round(value)))
              }
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <CheckboxField
              label="hazmat"
              checked={hgvParams.hazmat}
              onChange={(value) => setHgvParam("hazmat", value)}
            />
            <CheckboxField
              label="water"
              checked={hgvParams.hazmatWater}
              onChange={(value) => setHgvParam("hazmatWater", value)}
            />
            <CheckboxField
              label="trailer"
              checked={hgvParams.trailer}
              onChange={(value) => setHgvParam("trailer", value)}
            />
          </div>
        </section>

        <section className="grid gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            profiles
          </span>
          <div className="grid grid-cols-2 gap-2">
            <CheckboxField
              label="HGV"
              checked={activeProfiles.HGV}
              onChange={(checked) =>
                setActiveProfiles((current) => ({ ...current, HGV: checked }))
              }
            />
            <CheckboxField
              label="CAR"
              checked={activeProfiles.CAR}
              onChange={(checked) =>
                setActiveProfiles((current) => ({ ...current, CAR: checked }))
              }
            />
          </div>
        </section>

        <section className="grid gap-2 rounded-md border border-border bg-muted/50 p-2 text-xs">
          {routeModes.map((mode) => {
            const routeResult = routeByMode.get(mode);
            return (
              <label
                key={mode}
                className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2"
              >
                <input
                  className="size-4 rounded border-input accent-primary"
                  type="checkbox"
                  checked={visibleRoutes[mode]}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setVisibleRoutes((current) => ({
                      ...current,
                      [mode]: checked,
                    }));
                  }}
                />
                <span
                  className="h-1.5 w-7 rounded-full"
                  style={{ backgroundColor: routeColors[mode].color }}
                />
                <span className="font-semibold">{mode}</span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {formatDuration(routeResult?.duration)}
                  {routeResult?.distance
                    ? ` / ${formatDistance(routeResult.distance)}`
                    : ""}
                </span>
              </label>
            );
          })}

          <Button
            className="mt-1 w-full"
            size="sm"
            variant="outline"
            disabled={!hasVisibleRoutes}
            onClick={() => {
              if (mapRef.current) {
                fitRoutes(
                  mapRef.current,
                  visibleRouteResults,
                  start,
                  destination,
                );
              }
            }}
          >
            <LocateFixed className="size-3.5" />
            Fit
          </Button>

          {requestState.status === "loading" ? (
            <div className="text-muted-foreground">routing...</div>
          ) : null}
          {requestState.status === "error" ? (
            <div className="text-destructive">{requestState.message}</div>
          ) : null}
        </section>
      </aside>

      {contextMenu ? (
        <div
          className="fixed z-20 min-w-36 overflow-hidden rounded-md border border-border/80 bg-popover p-1 text-sm text-popover-foreground shadow-xl"
          style={{ left: contextMenu.point.x, top: contextMenu.point.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            type="button"
            onClick={() => {
              setStart(contextMenu.lngLat);
              setContextMenu(null);
            }}
          >
            <Route className="size-3.5 text-green-600" />
            from here
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
            type="button"
            onClick={() => {
              setDestination(contextMenu.lngLat);
              setContextMenu(null);
            }}
          >
            <Route className="size-3.5 text-red-600" />
            to here
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted"
            type="button"
            onClick={() => setContextMenu(null)}
          >
            <X className="size-3.5" />
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
