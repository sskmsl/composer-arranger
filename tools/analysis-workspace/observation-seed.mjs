const CREATED_AT = "2026-07-30T00:00:00.000Z"

const GROUPS = [
  [
    "density",
    [
      "Sparse Arrangement",
      "Dense Arrangement",
      "Gradual Layer Addition",
      "Gradual Layer Removal",
      "Foreground Background Separation",
      "Single Focal Element",
      "Alternating Active Parts",
      "Sustained Background Layer",
    ],
  ],
  [
    "register",
    [
      "Narrow Register",
      "Wide Register",
      "Register Expansion",
      "Register Contraction",
      "High Register Accent",
      "Low Register Foundation",
      "Register Separation Between Parts",
      "Register Overlap Between Parts",
    ],
  ],
  [
    "rhythm",
    [
      "Late Bass Entry",
      "Behind-the-Beat Feel",
      "Straight Pulse",
      "Syncopated Bass",
      "Repeating Ostinato",
      "Sparse Percussion",
      "Ghost Percussion",
      "Sustained Rhythm Reduction",
      "Rhythmic Activity Increase",
    ],
  ],
  [
    "texture",
    [
      "Wide Atmospheric Pad",
      "Dark Filtered Pad",
      "Bell Texture",
      "Noise Layer",
      "Tape Texture",
      "Distorted Texture",
      "Breath-like Texture",
      "Metallic Resonance",
      "Layered Choir Texture",
    ],
  ],
  [
    "space",
    [
      "Long Reverb Tail",
      "Short Room Ambience",
      "Wide Stereo Field",
      "Narrow Stereo Field",
      "Distant Sound Placement",
      "Dry Foreground Element",
      "Wet Background Element",
      "Pre-Delay Separation",
      "Delay-based Depth",
    ],
  ],
  [
    "transition",
    [
      "Reverse Entry",
      "Filter Rise",
      "Filter Closure",
      "Silence Before Entry",
      "Impact Accent",
      "Noise Sweep",
      "Reverb Tail Transition",
      "Element Dropout",
      "Register Lift Before Entry",
      "Density Reduction Before Entry",
    ],
  ],
  [
    "dynamics",
    [
      "Gradual Energy Increase",
      "Gradual Energy Decrease",
      "Sudden Energy Increase",
      "Sudden Energy Decrease",
      "Dynamic Contrast Between Sections",
      "Sustained Low Energy",
      "Climax Register Expansion",
    ],
  ],
]

const ALIASES = {
  "Sparse Arrangement": [
    "Low Density Arrangement",
    "Minimal Layering",
    "Few Simultaneous Parts",
  ],
  "Reverse Entry": [
    "Reverse Atmosphere",
    "Reverse FX Entry",
    "Reverse Transition",
  ],
  "Wide Atmospheric Pad": ["Wide Pad", "Atmospheric Wide Pad"],
  "Long Reverb Tail": ["Long Reverb Decay", "Extended Reverb Tail"],
}

const OPPOSITES = [
  ["Sparse Arrangement", "Dense Arrangement"],
  ["Gradual Layer Addition", "Gradual Layer Removal"],
  ["Narrow Register", "Wide Register"],
  ["Register Expansion", "Register Contraction"],
  ["Register Separation Between Parts", "Register Overlap Between Parts"],
  ["Wide Stereo Field", "Narrow Stereo Field"],
  ["Dry Foreground Element", "Wet Background Element"],
  ["Gradual Energy Increase", "Gradual Energy Decrease"],
  ["Sudden Energy Increase", "Sudden Energy Decrease"],
]

const RELATED = {
  "Sparse Arrangement": [
    "Single Focal Element",
    "Wide Stereo Field",
    "Sustained Background Layer",
  ],
  "Wide Atmospheric Pad": [
    "Wide Stereo Field",
    "Long Reverb Tail",
    "Sustained Background Layer",
  ],
  "Reverse Entry": [
    "Silence Before Entry",
    "Reverb Tail Transition",
    "Noise Sweep",
  ],
}

export function createObservationSeed() {
  const entries = GROUPS.flatMap(([category, names]) =>
    names.map((canonicalName) => ({ category, canonicalName })),
  )
  const idByName = new Map(
    entries.map((entry, index) => [
      entry.canonicalName,
      `OBS-${String(index + 1).padStart(4, "0")}`,
    ]),
  )
  const oppositeNames = new Map()
  for (const [left, right] of OPPOSITES) {
    oppositeNames.set(left, [...(oppositeNames.get(left) ?? []), right])
    oppositeNames.set(right, [...(oppositeNames.get(right) ?? []), left])
  }
  return entries.map((entry, index) => ({
    id: `OBS-${String(index + 1).padStart(4, "0")}`,
    canonicalName: entry.canonicalName,
    description: `Observable musical fact: ${entry.canonicalName}.`,
    category: entry.category,
    aliases: ALIASES[entry.canonicalName] ?? [],
    valueType: "boolean",
    relatedObservationIds: (RELATED[entry.canonicalName] ?? [])
      .map((name) => idByName.get(name))
      .filter(Boolean),
    oppositeObservationIds: (oppositeNames.get(entry.canonicalName) ?? [])
      .map((name) => idByName.get(name))
      .filter(Boolean),
    status: "active",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }))
}

export const OBSERVATION_SEED_COUNT = GROUPS.reduce(
  (sum, [, names]) => sum + names.length,
  0,
)
