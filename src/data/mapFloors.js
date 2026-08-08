// Elevation bands for the floor badge on position pings (Phase 6).
//
// Copied verbatim from the `layers[].heightRange` values in tarkov-dev's
// src/data/maps.json (fetched 2026-08-07). Only maps whose bands are
// non-overlapping and cover the whole axis are listed — a map is here or it is
// not, and one that is not shows a raw elevation instead of a guessed floor.
//
// Deliberately absent, with the reason:
//   customs    — its 2nd/3rd Floor layers carry several disjoint ranges each
//                (per building), so a single elevation does not identify a floor.
//   reserve    — 2nd/3rd/4th Floor overlap heavily (-3.5..25.7 vs -0.64..29.3);
//                only the Bunkers band below -3.2 is unambiguous, so that is all
//                we claim.
//   shoreline  — upstream's ranges are inconsistent (map -1000..-1 with a
//                "2nd Floor" at -1..2). Not trustworthy enough to badge.
//   woods, lighthouse — no layers upstream; both are single-level in practice.
//
// Each entry is ascending by `below`; the last band uses Infinity.
export const MAP_FLOORS = {
  factory: [
    { below: -1,       label: 'TUNNELS'   },
    { below: 3,        label: 'GROUND'    },
    { below: 6,        label: '2ND FLOOR' },
    { below: Infinity, label: '3RD FLOOR' },
  ],
  'the-lab': [
    { below: -0.9,     label: 'TECHNICAL' },
    { below: 3,        label: 'MAIN'      },
    { below: Infinity, label: '2ND LEVEL' },
  ],
  'streets-of-tarkov': [
    { below: -6,       label: 'UNDERGROUND' },
    { below: 10,       label: 'GROUND'      },
    { below: 15,       label: '2ND FLOOR'   },
    { below: 20,       label: '3RD FLOOR'   },
    { below: 25,       label: '4TH FLOOR'   },
    { below: Infinity, label: '5TH FLOOR'   },
  ],
  interchange: [
    { below: 25,       label: 'GROUND'    },
    { below: 34,       label: '2ND FLOOR' },
    { below: Infinity, label: '3RD FLOOR' },
  ],
  'ground-zero': [
    { below: 26,       label: 'GROUND'    },
    { below: 32.3,     label: '2ND FLOOR' },
    { below: Infinity, label: '3RD FLOOR' },
  ],
  reserve: [
    { below: -3.2,     label: 'BUNKERS' },
    { below: Infinity, label: 'SURFACE' },
  ],
}
