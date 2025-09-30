export type TimeSec = number; // 0..86400
export type NodeId = string;

export type CurveControlPoint = { x: number; y: number };
export type CurveState = {
  controls: CurveControlPoint[];   // 4+ anchors for Catmull-Rom; start with 4
  tension: number;                 // 0..1 (0 = loose/smooth, 1 = tight)
};

export type NodeModel = {
  id: NodeId;
  time: TimeSec;                   // canonical time (seconds in day)
  label: string;
  icon: string;                    // token name or URL (host renders)
  color: string;                   // CSS token or hex
};

export type CurveKitProps = {
  curve: CurveState;
  nodes: NodeModel[];
  onCurveChange?: (next: CurveState) => void;   // fired while sculpting
  onNodeChange?: (id: NodeId, nextTime: TimeSec) => void; // drag along path
  onNodeTap?: (id: NodeId) => void;             // host handles editor
  mode?: 'view' | 'sculpt' | 'plan';            // sculpt toggles handles
  readOnly?: boolean;
};

export type Vec2 = { x: number; y: number };

export type Cubic = { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 };

export type LUT = {
  // Global lookup over all segments
  // arrays aligned by index: [0..N]
  t: number[];       // global t in [0,1]
  s: number[];       // cumulative arc length in px, [0..L]
  segIndex: number[];// which segment covers this sample
  pt: Vec2[];        // sampled points
  length: number;    // total length (px)
  segments: Cubic[]; // the cubic segments used
};


