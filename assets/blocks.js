/* Framework — block art.
 *
 * Draws the studio's axonometric white-block sculptures. One source of truth for the
 * site, the social exports and anything else that needs the mark's 3D vocabulary.
 *
 * Three ways in:
 *
 *   Browser, declarative
 *     <fw-blocks composition="stack" ratio="1:1" theme="ink"></fw-blocks>
 *
 *   Browser or Node, programmatic
 *     FrameworkBlocks.svg({ composition: 'tower', ratio: '9:16' })  -> SVG string
 *     FrameworkBlocks.element({ ... })                              -> SVGElement
 *
 *   Node, CLI
 *     node assets/blocks.js --composition stack --ratio 3:4 > assets/hero-blocks.svg
 *
 * Geometry lives in an (a, b, z) grid: a runs right-and-down, b runs left-and-down,
 * z runs up. A box is a corner plus a size, so compositions read as a list of solids
 * rather than a pile of coordinates. Draw order is painter's order — list the boxes
 * furthest-back first, and anything stacked on top after the box it sits on.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkBlocks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var K = 0.866; // cos(30°) — the axonometric squash

  /* ---------- Palettes ---------- */

  var THEMES = {
    // White blocks on the warm paper ground.
    paper: {
      top: '#FCFBF9',
      left: '#F1EFEB',
      right: '#E4E1DA',
      edge: 'rgba(22,23,26,0.10)',
      shadow: 'rgba(22,23,26,0.16)',
      ink: '#16171A'
    },
    // Same blocks reading against ink: deeper side shading, heavier shadow.
    ink: {
      top: '#F5F4F1',
      left: '#D9D7D1',
      right: '#B7B4AC',
      edge: 'rgba(22,23,26,0.18)',
      shadow: 'rgba(0,0,0,0.45)',
      ink: '#16171A'
    }
  };

  /* ---------- The mark ---------- */

  // The studio's F, laid flat on the ground and broken into nine bars — then each bar
  // pushed out along the camera's own axis, the (1,1,1) direction, which is the one
  // direction a solid can travel without moving where it lands on screen. From the
  // hero's angle the bars line up into the mark exactly. Turn the sculpture and they
  // drift apart into a pile of loose beams that spell nothing at all.
  //
  // Cells are addressed in the letter's own grid: r across, u up, nine rows by eight
  // columns. On the ground the letter's up runs along -a and its right along -b.
  var MODULE = 48;
  var JOINT = 4;   // shrink each bar off its modules, so the joints stay visible

  // A bar at `lift: 1` hangs FLOOR clear of the ground, and every step above that adds
  // another LIFT. The two do different jobs.
  //
  // FLOOR separates a bar from its own shadow. Hang one too low and the shadow creeps
  // back underneath it until bar and shadow read as a single fused shape.
  //
  // LIFT separates the bars from each other. It has to be big enough that no two of them
  // overlap on screen at any angle of the turn — below about a module and a third they
  // start crossing halfway round, and two solids intersecting reads as one odd shape
  // rather than as a pile.
  //
  // Both are paid for in frame: the highest bar decides how far the frame must open to
  // hold its swinging shadow, and a wider frame means a smaller letter inside it. This
  // spacing costs the letter about a sixth of its width. It is worth it.
  var FLOOR = MODULE * 2;
  var LIFT = MODULE * 4 / 3;

  // r, u  where the run starts · len · the axis it runs along · how far out it is pushed,
  // in LIFT steps above FLOOR. Neighbouring bars want lifts far apart — that difference is
  // what the turn pulls open. What caps it is the shadow: the higher a bar hangs the
  // further right its shadow lands, so the bars down the right-hand side stay low, or
  // their shadows drag the frame open and shrink the letter inside it.
  var MARK_RUNS = [
    { r: 0, u: 0, len: 3, axis: 'u', lift: 2 },  // stem, four bars bottom to top
    { r: 0, u: 3, len: 2, axis: 'u', lift: 4 },
    { r: 0, u: 5, len: 2, axis: 'u', lift: 1 },
    { r: 0, u: 7, len: 2, axis: 'u', lift: 3 },
    { r: 1, u: 8, len: 2, axis: 'r', lift: 4 },  // top arm, three bars
    { r: 3, u: 8, len: 3, axis: 'r', lift: 1 },
    { r: 6, u: 8, len: 2, axis: 'r', lift: 2 },
    { r: 3, u: 4, len: 2, axis: 'r', lift: 3 },  // crossbar, clear of the stem
    { r: 5, u: 4, len: 3, axis: 'r', lift: 1 }
  ];

  function markBoxes() {
    return MARK_RUNS.map(function (run) {
      var across = run.axis === 'r' ? run.len : 1;
      var along = run.axis === 'u' ? run.len : 1;
      var out = FLOOR + (run.lift - 1) * LIFT;
      return {
        a: out + JOINT - (run.u + along) * MODULE,
        b: out + JOINT - (run.r + across) * MODULE,
        da: along * MODULE - 2 * JOINT,
        db: across * MODULE - 2 * JOINT,
        h: MODULE,
        z: out,
        cast: true
      };
    });
  }

  /* ---------- Compositions ---------- */

  var COMPOSITIONS = {
    // The hero: the mark itself, only true from one angle. See markBoxes().
    mark: markBoxes(),
    // An anchor cube with a slab behind it and a column in front.
    stack: [
      { a: -118, b: -8, da: 46, db: 46, h: 196 },
      { a: -58, b: -54, da: 74, db: 74, h: 68 },
      { a: -40, b: -36, da: 38, db: 38, h: 38, z: 68 },
      { a: 18, b: -116, da: 100, db: 50, h: 30 },
      { a: 48, b: 34, da: 30, db: 30, h: 148 }
    ],
    // A skyline of four equal footprints at rising heights. Reads well square or wide.
    row: [
      { a: -160, b: -30, da: 56, db: 56, h: 44 },
      { a: -88, b: -30, da: 56, db: 56, h: 120 },
      { a: -16, b: -30, da: 56, db: 56, h: 76 },
      { a: 56, b: -30, da: 56, db: 56, h: 164 }
    ],
    // A stepped pyramid — the tall option, for stories and portrait crops.
    tower: [
      { a: -45, b: -45, da: 90, db: 90, h: 60 },
      { a: -32, b: -32, da: 64, db: 64, h: 56, z: 60 },
      { a: -22, b: -22, da: 44, db: 44, h: 52, z: 116 },
      { a: -14, b: -14, da: 28, db: 28, h: 44, z: 168 }
    ],
    // Two posts and a lintel. The most architectural of the set.
    gate: [
      { a: -110, b: -40, da: 40, db: 40, h: 170 },
      { a: 60, b: -40, da: 40, db: 40, h: 170 },
      { a: -110, b: -40, da: 210, db: 40, h: 38, z: 170 }
    ]
  };

  /* ---------- Seeded composition ---------- */

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Lays solids on a loose 3-wide grid so they cluster instead of drifting apart.
  function generate(seed, count) {
    var rand = mulberry32(seed);
    var pick = function (list) { return list[Math.floor(rand() * list.length)]; };
    var slots = [
      { a: -140, b: -20 }, { a: -70, b: -80 }, { a: -60, b: 20 },
      { a: 10, b: -110 }, { a: 20, b: -20 }, { a: 40, b: 50 }
    ];
    var n = count || 4 + Math.floor(rand() * 3);
    var boxes = [];

    for (var i = 0; i < slots.length && boxes.length < n; i++) {
      if (boxes.length && rand() < 0.25) continue; // leave the odd slot empty

      var slot = slots[i];
      var foot = pick([34, 46, 56, 68]);
      var tall = pick([34, 62, 96, 140, 184]);
      var box = { a: slot.a, b: slot.b, da: foot, db: foot, h: tall };
      boxes.push(box);

      // Occasionally cap a wide, low solid with a smaller one.
      if (foot >= 56 && tall <= 96 && rand() < 0.45) {
        var cap = Math.round(foot * 0.55);
        boxes.push({
          a: slot.a + Math.round((foot - cap) / 2),
          b: slot.b + Math.round((foot - cap) / 2),
          da: cap, db: cap, h: Math.round(cap * 1.1), z: tall
        });
      }
    }

    // Painter's order: furthest back first, then anything resting on top.
    return boxes.sort(function (p, q) {
      return (p.z || 0) - (q.z || 0) || (p.a + p.b) - (q.a + q.b);
    });
  }

  /* ---------- Geometry ---------- */

  function project(a, b, c) {
    return [K * (a - b), 0.5 * (a + b) - c];
  }

  function points(list) {
    return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  }

  // The eight corners of a solid as (a, b, up), the bottom four then the top four.
  function corners(solid) {
    var out = [];
    [solid.z, solid.z + solid.h].forEach(function (up) {
      solid.base.forEach(function (p) { out.push([p[0], p[1], up]); });
    });
    return out;
  }

  // The faces of a solid that are in shot, furthest first: the two sides facing the
  // camera, then the cap.
  //
  // (a, b, z) is an orthonormal frame — two ground axes at right angles and up — seen
  // down (1, 1, 1). So a vertical face is in shot when its outward normal leans towards
  // the camera, n.a + n.b > 0, and it reads as the light or the dark side by the same key
  // the rendered version uses. At rest that picks out the +a and +b faces, exactly the
  // two this renderer has always drawn; turned, it picks whichever two now face the
  // camera, which is the whole reason the test is a dot product rather than a constant.
  function solidFaces(solid) {
    var z = solid.z;
    var top = z + solid.h;
    var sides = [];

    for (var i = 0; i < 4; i++) {
      var p = solid.base[i];
      var q = solid.base[(i + 1) % 4];
      var n = [q[1] - p[1], p[0] - q[0]];       // outward normal of the edge p -> q
      if (n[0] + n[1] <= 0) continue;           // facing away, or edge-on

      sides.push({
        lit: n[0] * LIGHT.a + n[1] * LIGHT.b >= 0,
        points: [project(p[0], p[1], z), project(q[0], q[1], z), project(q[0], q[1], top), project(p[0], p[1], top)]
      });
    }

    // Lit side, dark side, cap — the order this renderer has always laid a box down in.
    sides.sort(function (x, y) { return (y.lit ? 1 : 0) - (x.lit ? 1 : 0); });
    sides.push({ cap: true, points: solid.base.map(function (c) { return project(c[0], c[1], top); }) });
    return sides;
  }

  // What the solid would cover if it were lying on the ground — the soft shadow's shape
  // in the un-engraved theme, where a blur stands in for a cast.
  function groundFace(solid) {
    return solid.base.map(function (c) { return project(c[0], c[1], 0); });
  }

  function parseRatio(ratio) {
    // 'auto' keeps whatever shape the composition itself came out as.
    if (ratio === 'auto') return null;
    if (typeof ratio === 'number' && ratio > 0) return ratio;
    var parts = String(ratio || '3:4').split(':');
    var w = parseFloat(parts[0]);
    var h = parseFloat(parts[1]);
    if (!(w > 0) || !(h > 0)) return 3 / 4;
    return w / h;
  }

  function resolve(composition, seed) {
    if (Array.isArray(composition)) return composition;
    if (POSES[composition]) return resolve(POSES[composition].of, seed);
    if (COMPOSITIONS[composition]) return COMPOSITIONS[composition];
    return generate(typeof seed === 'number' ? seed : 1);
  }

  /* ---------- Hatch ---------- */

  // The flat renderer has to agree with the WebGL one, or the hero visibly jumps from
  // flat art to engraved art the moment three.js finishes loading. Each face gets a line
  // density derived from the tone that face reads at when rendered: white top, glancing
  // side, dark side, and the densest screen of all in the cast shadow.
  //
  // Pattern ids are fixed rather than random so identical markup stays identical. Two
  // sculptures on one page therefore share a definition, which is harmless — the
  // definitions are byte-identical.
  var HATCH = [
    { id: 'fw-hatch-top', duty: 0.05 },
    { id: 'fw-hatch-left', duty: 0.30 },
    { id: 'fw-hatch-right', duty: 0.66 },
    { id: 'fw-hatch-cast', duty: 0.80, cross: true }
  ];

  // Matched to the WebGL renderer's 7 device pixels at its reference size, so the two
  // engravings have the same line frequency rather than one looking coarser.
  var HATCH_PITCH = 4.2;

  // Same key light the rendered version uses, expressed in this module's (a, b, up) grid.
  var LIGHT = { a: -0.68, b: 0.30, up: 0.669 };

  // Where a solid lands on the ground once the key pushes it. The cast of a box under a
  // directional light is a hexagon, so project all eight corners and take the hull rather
  // than guessing at the silhouette.
  function castPolygon(solid) {
    return hull(corners(solid).map(function (c) {
      var t = c[2] / LIGHT.up;
      return project(c[0] - LIGHT.a * t, c[1] - LIGHT.b * t, 0);
    }));
  }

  // Andrew's monotone chain.
  function hull(input) {
    var pts = input.slice().sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    if (pts.length < 3) return pts;

    var cross = function (o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    var build = function (list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], list[i]) <= 0) out.pop();
        out.push(list[i]);
      }
      out.pop();
      return out;
    };

    return build(pts).concat(build(pts.slice().reverse()));
  }

  function hatchDefs(ink) {
    var patterns = HATCH.map(function (band) {
      var width = (HATCH_PITCH * band.duty).toFixed(2);
      var lines = '      <rect width="' + width + '" height="' + HATCH_PITCH + '" fill="' + ink + '"/>';
      if (band.cross) {
        // Second pass at the opposite angle closes the darkest band down further.
        lines += '\n      <rect width="' + HATCH_PITCH + '" height="' +
          (HATCH_PITCH * 0.34).toFixed(2) + '" fill="' + ink + '"/>';
      }
      return '    <pattern id="' + band.id + '" width="' + HATCH_PITCH + '" height="' + HATCH_PITCH +
        '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">\n' + lines + '\n    </pattern>';
    });
    return '  <defs>\n' + patterns.join('\n') + '\n  </defs>';
  }

  /* ---------- Framing for a turn ---------- */

  // How a composition wants to be framed, when that is a property of the sculpture
  // rather than of whoever is drawing it. `mark` is the case: it only reads as the F
  // from one angle, the hero turns it through this range, and every frame of that turn
  // has to fit — so the frame is wider and the solids sit smaller than a static shot
  // would need. Anything else drawing `mark` has to frame it identically or it is
  // visibly a different sculpture. Callers may still override.
  // `padding` belongs here too, and for the same reason: the two renderers default it
  // differently — 1.16 flat, 1.06 rendered — so a `mark` regenerated from the CLI came out
  // a tenth larger than the canvas drew it. One number, one place.
  var FRAMING = {
    mark: { yawRange: [0, 1.25], shadowRoom: 0.8, padding: 1.06 }
  };

  // A pose is a named composition seen from a fixed angle other than its rest angle.
  // `mark` only collapses into the F from one angle; `mark-loose` is those same nine bars
  // at the far end of the hero's turn, where they read as a scattered pile — the shape the
  // hero opens on, and the one still that says "not finished yet" in the studio's own
  // vocabulary. Same boxes, same frame, one number apart.
  //
  // That number is the end of `mark`'s own yaw range rather than a copy of it, so the pose
  // is the hero's opening frame by construction and cannot drift away from it.
  var POSES = {
    'mark-loose': { of: 'mark', yaw: FRAMING.mark.yawRange[1] }
  };

  // The angle a composition is drawn at. Zero for everything that is not a pose.
  function poseYaw(composition) {
    return POSES[composition] ? POSES[composition].yaw : 0;
  }

  // Every name that can be asked for, each pose listed straight after the composition it
  // turns, so the two ends of the hero's cycle sit side by side wherever names are offered
  // as a choice.
  function compositionNames() {
    var names = [];
    Object.keys(COMPOSITIONS).forEach(function (name) {
      names.push(name);
      Object.keys(POSES).forEach(function (pose) {
        if (POSES[pose].of === name) names.push(pose);
      });
    });
    return names;
  }

  // A pose frames exactly as the composition it turns does — that is the point of it.
  function framingFor(composition) {
    if (POSES[composition]) return framingFor(POSES[composition].of);
    return FRAMING[composition] || {};
  }

  // The rendered version can turn a composition on the spot, and `mark` exists to be
  // turned. If the flat renderer framed only the angle it draws, the canvas would have to
  // open its frame wider to keep the far end of the turn in shot — and every solid would
  // jump smaller the moment three.js arrived. So the flat renderer can be asked to leave
  // room for a turn it will not itself draw: same points, same box, same size on screen
  // across the swap. `yawRange` is a radian range, or a single radian meaning from zero.
  function yawSamples(range) {
    var from = 0;
    var to = 0;
    if (Array.isArray(range)) { from = range[0] || 0; to = range[1] || 0; }
    else if (typeof range === 'number') { to = range; }
    if (from === to) return [];

    var steps = 8;
    var out = [];
    for (var i = 0; i <= steps; i++) out.push(from + (to - from) * (i / steps));
    return out;
  }

  // Turning happens about the vertical axis through the middle of the composition's
  // footprint, which is where blocks3d puts its pivot.
  function footprintCentre(boxes) {
    var minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    boxes.forEach(function (box) {
      minA = Math.min(minA, box.a); maxA = Math.max(maxA, box.a + box.da);
      minB = Math.min(minB, box.b); maxB = Math.max(maxB, box.b + box.db);
    });
    return { a: (minA + maxA) / 2, b: (minB + maxB) / 2 };
  }

  // Where a solid's corners land on the floor once the key pushes them, walked only
  // `room` of the way out. The shadow is still *drawn* whole; this is only what the frame
  // is asked to hold, which is why the tips of a long cast are allowed off the edge.
  function castFraming(solid, room) {
    return corners(solid).map(function (c) {
      var t = c[2] / LIGHT.up;
      return project(c[0] - LIGHT.a * t * room, c[1] - LIGHT.b * t * room, c[2] * (1 - room));
    });
  }

  // A box turned about that pivot is no longer axis-aligned, so it stops being a corner
  // plus a size and becomes four ground corners plus a height. At rest that is the same
  // solid written down differently, which is why one drawing path serves both.
  function casts(solid) {
    return solid.cast || !solid.z;
  }

  function poseSolids(boxes, yaw) {
    var centre = footprintCentre(boxes);
    var cos = Math.cos(yaw);
    var sin = Math.sin(yaw);

    // Left exact rather than merely equal at rest: a turn of zero must not nudge the
    // coordinates through a rounding, or every composition redraws a hair off itself.
    var turn = yaw
      ? function (a, b) {
        var da = a - centre.a;
        var db = b - centre.b;
        return [da * cos + db * sin + centre.a, -da * sin + db * cos + centre.b];
      }
      : function (a, b) { return [a, b]; };

    var solids = boxes.map(function (box) {
      return {
        base: [
          turn(box.a, box.b), turn(box.a + box.da, box.b),
          turn(box.a + box.da, box.b + box.db), turn(box.a, box.b + box.db)
        ],
        z: box.z || 0,
        h: box.h,
        cast: box.cast
      };
    });

    // Painter's order is hand-authored into each composition and only holds at rest, so a
    // turned pose has to sort for itself. Depth runs along the view direction, which in
    // this grid is simply a + b + z.
    if (yaw) {
      solids.sort(function (x, y) { return depth(x) - depth(y); });
    }

    return solids;
  }

  function depth(solid) {
    var sum = 0;
    solid.base.forEach(function (p) { sum += p[0] + p[1]; });
    return sum / 4 + solid.z + solid.h / 2;
  }

  // Every corner of every solid at every sampled angle. Solids only, deliberately: the
  // frame holds every block through the whole turn, and holds the cast shadow only where
  // it falls at rest — the angle the composition is actually drawn at, already in `all`
  // as the cast polygons. Past that the shadow is allowed off the edge.
  //
  // The reason is arithmetic. A block hanging in mid-air throws its shadow a long way to
  // one side and swings it much further than it moves itself, so reserving frame for the
  // shadow at every angle costs the letter a third of its width. No block is ever sliced;
  // a shadow leaving the frame mid-turn is the cheaper thing to give up by a distance.
  function turnedPoints(boxes, yaws) {
    var centre = footprintCentre(boxes);
    var points = [];

    yaws.forEach(function (yaw) {
      var cos = Math.cos(yaw);
      var sin = Math.sin(yaw);

      boxes.forEach(function (box) {
        var z = box.z || 0;

        for (var i = 0; i < 8; i++) {
          var da = (box.a + ((i & 1) ? box.da : 0)) - centre.a;
          var db = (box.b + ((i & 2) ? box.db : 0)) - centre.b;
          var a = da * cos + db * sin + centre.a;
          var b = -da * sin + db * cos + centre.b;

          points.push(project(a, b, z + ((i & 4) ? box.h : 0)));
        }
      });
    });

    return points;
  }

  /* ---------- Render ---------- */

  function svg(options) {
    var opt = options || {};
    var boxes = resolve(opt.composition || 'stack', opt.seed);
    var theme = typeof opt.theme === 'object' ? opt.theme : (THEMES[opt.theme] || THEMES.paper);
    var ratio = parseRatio(opt.ratio);
    var pad = typeof opt.padding === 'number' ? opt.padding
      : (typeof framingFor(opt.composition).padding === 'number'
        ? framingFor(opt.composition).padding : 1.16);
    var withShadow = opt.shadow !== false;
    var framing = framingFor(opt.composition);
    var yawRange = opt.yawRange !== undefined ? opt.yawRange : framing.yawRange;
    var room = typeof opt.shadowRoom === 'number' ? opt.shadowRoom
      : (typeof framing.shadowRoom === 'number' ? framing.shadowRoom : 1);
    var yaw = typeof opt.yaw === 'number' ? opt.yaw : poseYaw(opt.composition);
    var solids = poseSolids(boxes, yaw);
    var hatched = opt.style !== 'flat';
    var ink = theme.ink || '#16171A';
    var edge = hatched ? ink : theme.edge;
    var base = hatched ? '#FFFFFF' : null;

    var all = [];
    var shadowParts = [];
    var solidParts = [];

    solids.forEach(function (solid) {
      var faces = solidFaces(solid);
      faces.forEach(function (face) { all = all.concat(face.points); });

      // A raised box is normally resting on the one under it, and its shadow belongs on
      // that box rather than on the floor — so by default only ground-level solids cast.
      // `cast: true` is the exception: a solid genuinely hanging over open ground.
      if (withShadow && casts(solid)) {
        shadowParts.push(hatched
          ? '    <polygon points="' + points(castPolygon(solid)) + '" fill="url(#fw-hatch-cast)"/>'
          : '    <polygon points="' + points(groundFace(solid)) + '" fill="' + theme.shadow + '"/>');
      }

      // Hatch patterns are transparent between the lines, so a solid ground goes down
      // first — otherwise the lines of a box behind show through the one in front.
      var under = '';
      var drawn = [];

      faces.forEach(function (face) {
        var fill = face.cap ? (hatched ? 'url(#fw-hatch-top)' : theme.top)
          : face.lit ? (hatched ? 'url(#fw-hatch-left)' : theme.left)
            : (hatched ? 'url(#fw-hatch-right)' : theme.right);

        if (base) under += '    <polygon points="' + points(face.points) + '" fill="' + base + '"/>\n';
        drawn.push('    <polygon points="' + points(face.points) + '" fill="' + fill +
          '" stroke="' + edge + '" stroke-width="1"/>');
      });

      solidParts.push(under + drawn.join('\n'));
    });

    // The frame holds the cast only where it falls at rest, never where a turn throws it.
    // A block hanging in mid-air swings its shadow much further than it moves itself, so
    // framing the swing costs the letter a third of its width — and it is why a pose comes
    // out the same size as the composition it turns rather than shrunk to hold a shadow
    // that has already left the frame.
    if (withShadow) {
      poseSolids(boxes, 0).forEach(function (solid) {
        if (casts(solid)) all = all.concat(hatched ? castFraming(solid, room) : groundFace(solid));
      });
    }

    // Leave room for a turn the flat version does not draw, when one is coming.
    all = all.concat(turnedPoints(boxes, yawSamples(yawRange)));

    // Fit a viewBox of the requested ratio around whatever the composition drew.
    var xs = all.map(function (p) { return p[0]; });
    var ys = all.map(function (p) { return p[1]; });
    var minX = Math.min.apply(Math, xs), maxX = Math.max.apply(Math, xs);
    var minY = Math.min.apply(Math, ys), maxY = Math.max.apply(Math, ys);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    var w = (maxX - minX) * pad;
    var h = (maxY - minY) * pad;
    if (ratio) { if (w / h > ratio) h = w / ratio; else w = h * ratio; }

    var viewBox = [(cx - w / 2).toFixed(1), (cy - h / 2).toFixed(1), w.toFixed(1), h.toFixed(1)].join(' ');
    var label = opt.label || 'Abstract sculpture of stacked white blocks';

    // Blur via the CSS filter function rather than <filter id>, so the same options
    // always produce byte-identical markup and two instances never clash on an id.
    var body = [];
    if (hatched) body.push(hatchDefs(ink));
    if (shadowParts.length) {
      // Engraved shadows are drawn, not blurred — a soft edge would undo the whole point.
      body.push(hatched ? '  <g>' : '  <g style="filter:blur(7px)">', shadowParts.join('\n'), '  </g>');
    }
    body.push('  <g>', solidParts.join('\n'), '  </g>');

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '"' +
      ' preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + escapeAttr(label) + '">\n' +
      body.join('\n') + '\n</svg>\n';
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function element(options) {
    var holder = document.createElement('div');
    holder.innerHTML = svg(options);
    return holder.firstElementChild;
  }

  var api = {
    svg: svg,
    element: element,
    // Geometry only — blocks3d.js builds the WebGL version from the same boxes.
    boxes: resolve,
    generate: generate,
    compositions: compositionNames(),
    framing: FRAMING,
    framingFor: framingFor,
    poseYaw: poseYaw,
    themes: Object.keys(THEMES),
    COMPOSITIONS: COMPOSITIONS,
    THEMES: THEMES
  };

  /* ---------- <fw-blocks> ---------- */

  if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('fw-blocks')) {
    var FwBlocks = function () { return Reflect.construct(HTMLElement, [], FwBlocks); };
    FwBlocks.prototype = Object.create(HTMLElement.prototype);
    FwBlocks.prototype.constructor = FwBlocks;
    Object.setPrototypeOf(FwBlocks, HTMLElement);

    FwBlocks.observedAttributes = ['composition', 'ratio', 'theme', 'seed', 'label', 'shadow'];

    FwBlocks.prototype.connectedCallback = function () { this.render(); };
    FwBlocks.prototype.attributeChangedCallback = function () {
      if (this.isConnected) this.render();
    };
    FwBlocks.prototype.render = function () {
      var seed = this.getAttribute('seed');
      this.innerHTML = svg({
        composition: this.getAttribute('composition') || 'stack',
        ratio: this.getAttribute('ratio') || '3:4',
        theme: this.getAttribute('theme') || 'paper',
        seed: seed === null ? undefined : parseInt(seed, 10),
        label: this.getAttribute('label') || undefined,
        shadow: this.getAttribute('shadow') !== 'false'
      });
      var art = this.firstElementChild;
      if (art) {
        art.style.display = 'block';
        art.style.width = '100%';
        art.style.height = '100%';
      }
    };

    customElements.define('fw-blocks', FwBlocks);
  }

  /* ---------- CLI ---------- */

  if (typeof process !== 'undefined' && process.argv && typeof require !== 'undefined' &&
      typeof module !== 'undefined' && require.main === module) {
    var args = process.argv.slice(2);
    var flags = {};
    for (var i = 0; i < args.length; i += 2) {
      flags[args[i].replace(/^--/, '')] = args[i + 1];
    }
    process.stdout.write(svg({
      composition: flags.composition || 'stack',
      ratio: flags.ratio || '3:4',
      theme: flags.theme || 'paper',
      seed: flags.seed === undefined ? undefined : parseInt(flags.seed, 10),
      label: flags.label,
      shadow: flags.shadow !== 'false',
      yawRange: flags['yaw-range'] === undefined ? undefined : parseFloat(flags['yaw-range']),
      padding: flags.padding === undefined ? undefined : parseFloat(flags.padding)
    }));
  }

  return api;
});
