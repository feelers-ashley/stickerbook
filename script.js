const W = 240,
  SIZE = 72,
  WEIGHT = 5;
const COLOURS = [
  "#e8453c",
  "#f7e23a",
  "#f06ba8",
  "#f5a524",
  "#5bb450",
  "#8cc4ee",
  "#1c1c1c",
  "#ffffff",
];
const IDEAS = [
  "pencil — rect + triangle + rect",
  "flagpole — line + triangle + ellipse",
  "school bag — rect + rect + ellipse",
  "clock — ellipse + line + line",
  "bell — triangle + rect + ellipse",
  "ruler — rect + a row of short lines",
  "book — rect + rect + line",
  "apple — ellipse + line + triangle",
];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (n) => Math.floor(Math.random() * n);

let mode = "draw",
  tool = "rect",
  colour = COLOURS[0];
let shapes = [],
  undone = [],
  drag = null,
  moving = null; // drawn, being drawn, being moved
let stickers = [],
  nextId = 1; // the collection
let idea = rand(IDEAS.length),
  pad;

/* === shapes > p5 commands > code + pixels (1 list feeds both) === */

function shapeFrom(a, b) {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return tool === "line"
    ? { t: "line", c: colour, a, b }
    : {
        t: tool,
        c: colour,
        x,
        y,
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      };
}

const centre = (s) =>
  s.t === "line"
    ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
    : { x: s.x + s.w / 2, y: s.y + s.h / 2 };

function commands(list) {
  const out = [["clear"], ["noStroke"]];
  let fill = null,
    stroke = null,
    weighted = false;
  for (const s of list) {
    const turned = !!s.r,
      c = centre(s),
      ox = turned ? c.x : 0,
      oy = turned ? c.y : 0;
    const before = [fill, stroke, weighted];
    if (turned) out.push(["push"], ["translate", c.x, c.y], ["rotate", s.r]); // pop() puts the style back too
    if (s.t === "line") {
      if (stroke !== s.c) out.push(["stroke", s.c]);
      if (!weighted) out.push(["strokeWeight", WEIGHT]);
      stroke = s.c;
      weighted = true;
      out.push(["line", s.a.x - ox, s.a.y - oy, s.b.x - ox, s.b.y - oy]);
    } else {
      if (stroke) {
        out.push(["noStroke"]);
        stroke = null;
      }
      if (fill !== s.c) out.push(["fill", s.c]);
      fill = s.c;
      const x = s.x - ox,
        y = s.y - oy,
        { w, h } = s;
      out.push(
        s.t === "rect"
          ? ["rect", x, y, w, h]
          : s.t === "ellipse"
          ? ["ellipse", x + w / 2, y + h / 2, w, h]
          : ["triangle", x + w / 2, y, x, y + h, x + w, y + h]
      );
    }
    if (turned) {
      out.push(["pop"]);
      [fill, stroke, weighted] = before;
    }
  }
  return out.map(([n, ...a]) => [
    n,
    ...a.map((v) => (typeof v === "number" ? Math.round(v) : v)),
  ]);
}

function paint(p, list) {
  commands(list).forEach(([name, ...args]) =>
    name === "rotate" ? p.rotate(p.radians(args[0])) : p[name](...args)
  );
}

function snippet(list, name) {
  const fmt = (v) => (typeof v === "string" ? `'${v}'` : v);
  const body = commands(list)
    .slice(1)
    .map(([n, ...a]) =>
      n === "rotate"
        ? `  rotate(radians(${a[0]}));`
        : `  ${n}(${a.map(fmt).join(", ")});`
    );
  if (!list.length) body.push("  // drag on the canvas to add shapes");
  return [
    `function ${name}(x, y, s = 0.3) {`,
    "  push();",
    "  translate(x, y);",
    "  scale(s);",
    ...body,
    "  pop();",
    "}",
  ].join("\n");
}

function hit(s, x, y) {
  // check point on shape
  if (s.r) {
    // turn point back instead of turning the shape
    const c = centre(s),
      a = (-s.r * Math.PI) / 180,
      dx = x - c.x,
      dy = y - c.y;
    x = c.x + dx * Math.cos(a) - dy * Math.sin(a);
    y = c.y + dx * Math.sin(a) + dy * Math.cos(a);
  }
  if (s.t === "rect")
    return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  if (s.t === "ellipse")
    return (
      ((x - s.x - s.w / 2) / (s.w / 2)) ** 2 +
        ((y - s.y - s.h / 2) / (s.h / 2)) ** 2 <=
      1
    );
  if (s.t === "triangle")
    return (
      y >= s.y &&
      y <= s.y + s.h &&
      Math.abs(x - s.x - s.w / 2) <= (((y - s.y) / s.h) * s.w) / 2
    );
  const { a, b } = s,
    dx = b.x - a.x,
    dy = b.y - a.y; // line: distance to the segment
  const t = clamp(
    ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1
  );
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= WEIGHT / 2 + 4;
}

function shift(s, o, dx, dy) {
  // put shape at its old spot + offset
  if (s.t === "line") {
    s.a = { x: o.a.x + dx, y: o.a.y + dy };
    s.b = { x: o.b.x + dx, y: o.b.y + dy };
  } else {
    s.x = o.x + dx;
    s.y = o.y + dy;
  }
}

const current = () => shapes.concat(drag ? [shapeFrom(drag.a, drag.b)] : []);

/* === naming, sticking, 2 code views === */

const cap = (w) => w[0].toUpperCase() + w.slice(1);

function nameFor(text, id) {
  // remove white space in naming function
  const words = text
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let base = words
    .map((w, i) => (i ? cap(w.toLowerCase()) : w.toLowerCase()))
    .join("");
  if (!base) base = "sticker" + id;
  if (/^\d/.test(base)) base = "s" + base;
  return stickers.some((s) => s.name === base) ? base + id : base;
}

function stickIt() {
  if (!shapes.length) return;
  const id = nextId++;
  const name = nameFor($("name").value, id);
  stickers.unshift({ id, name, code: snippet(shapes, name) });
  shapes = [];
  undone = [];
  $("name").value = "";
  nextIdea();
  renderCode();
  renderCards(id);
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// colours follow the p5.js web editor (light theme)
const P5_FN = new Set(
  "setup draw createCanvas createGraphics background clear fill noFill stroke noStroke strokeWeight rect ellipse circle square triangle line quad arc point push pop translate rotate scale radians degrees random noise map lerp constrain dist sin cos tan abs floor ceil round sqrt min max color frameRate resizeCanvas windowResized redraw loop noLoop image loadImage imageMode rectMode ellipseMode angleMode pixelDensity text textSize textAlign mousePressed mouseReleased mouseDragged keyPressed".split(
    " "
  )
);
const P5_VAR = new Set(
  "width height mouseX mouseY pmouseX pmouseY windowWidth windowHeight frameCount PI TWO_PI HALF_PI CENTER CORNER DEGREES RADIANS".split(
    " "
  )
);
try {
  // check with p5
  Object.keys(p5.prototype).forEach((k) => {
    if (k[0] === "_") return;
    if (typeof p5.prototype[k] === "function") P5_FN.add(k);
    else if (/^[A-Z][A-Z_0-9]*$/.test(k)) P5_VAR.add(k);
  });
} catch (e) {
  /* p5 not loaded: the short lists above still apply */
}
const ATOM = new Set(["true", "false", "null", "undefined"]);
const KEYWORD = new Set(
  "function return if else for while do new of in this break continue switch case default class".split(
    " "
  )
);
const DEF = new Set(["const", "let", "var"]);
const TOKEN =
  /(\/\/.*)|('[^']*'|"[^"]*"|`[^`]*`)|(\b\d+\.?\d*\b)|(\.\s*[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)/g;

function hl(line) {
  let out = "",
    i = 0;
  line.replace(TOKEN, (m, com, str, num, prop, id, at) => {
    const cls = com
      ? "c"
      : str
      ? "s"
      : num
      ? "n"
      : prop
      ? "p"
      : DEF.has(id)
      ? "v"
      : KEYWORD.has(id)
      ? "k"
      : ATOM.has(id) || P5_VAR.has(id)
      ? "a"
      : P5_FN.has(id)
      ? "f"
      : "v";
    out += esc(line.slice(i, at)) + `<span class="${cls}">${esc(m)}</span>`;
    i = at + m.length;
    return m;
  });
  return out + esc(line.slice(i));
}

function renderCode() {
  // live snippet under the pad
  const text = snippet(current(), nameFor($("name").value, nextId));
  const lines = text.split("\n");
  $("code").innerHTML = lines
    .map((l) => `<div class="ln">${hl(l)}</div>`)
    .join("");
  $("meta").textContent = `${lines.length} lines`;
  if (pad) pad.redraw();
}

function renderCards(newId) {
  $("count").textContent =
    stickers.length + (stickers.length === 1 ? " sticker" : " stickers");
  $("cards").innerHTML = stickers.length
    ? ""
    : '<div class="empty">// nothing here yet. draw something, name it, and press make sticker.</div>';
  stickers.forEach((s) => {
    const card = document.createElement("div");
    card.className = "card" + (s.id === newId ? " new" : "");
    card.innerHTML =
      `<header><span>${esc(
        s.name
      )}</span><button class="ghost" title="remove">×</button></header>` +
      `<pre>${s.code.split("\n").map(hl).join("\n")}</pre>`;
    card.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      stickers = stickers.filter((t) => t !== s);
      renderCards();
    };
    card.onclick = () => {
      // select code so its ready to copy
      const r = document.createRange();
      r.selectNodeContents(card.querySelector("pre"));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    };
    $("cards").append(card);
  });
}

/* === editor, output page === */

const P5_SRC = document.querySelector('script[src*="p5"]').src;
const STARTER = `function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background('#ffffff');
  // e.g. pencil(100, 100, 0.4);
}

// paste your stickers below here, then call them in draw()
`;

/* inside output page (time every sticker call to be picked up + moved) */
function runtime() {
  const ov = {},
    prims = ["rect", "ellipse", "triangle", "line"];
  let frame = [],
    last = [],
    drag = null,
    lastErr = "";

  window.__s = (id, fn, x, y, ...rest) => {
    // sticker call: __s(id, pencil, 100, 100, 0.8)
    if (ov[id]) {
      x = ov[id].x;
      y = ov[id].y;
    }
    const b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 },
      orig = {};
    const add = (px, py) => {
      const q = drawingContext.getTransform().transformPoint({ x: px, y: py }),
        d = pixelDensity();
      b.x1 = Math.min(b.x1, q.x / d);
      b.y1 = Math.min(b.y1, q.y / d);
      b.x2 = Math.max(b.x2, q.x / d);
      b.y2 = Math.max(b.y2, q.y / d);
    };
    prims.forEach((n) => {
      orig[n] = window[n];
      window[n] = (...a) => {
        // note where each shape lands on page
        if (n === "rect") {
          add(a[0], a[1]);
          add(a[0] + a[2], a[1]);
          add(a[0], a[1] + a[3]);
          add(a[0] + a[2], a[1] + a[3]);
        } else if (n === "ellipse") {
          [-1, 1].forEach((i) =>
            [-1, 1].forEach((j) =>
              add(a[0] + (i * a[2]) / 2, a[1] + (j * a[3]) / 2)
            )
          );
        } else if (n === "triangle") {
          add(a[0], a[1]);
          add(a[2], a[3]);
          add(a[4], a[5]);
        } else {
          add(a[0], a[1]);
          add(a[2], a[3]);
        }
        return orig[n](...a);
      };
    });
    try {
      return fn(x, y, ...rest);
    } finally {
      prims.forEach((n) => {
        window[n] = orig[n];
      });
      if (b.x1 < 1e9) frame.push({ id, b, x, y });
    }
  };

  window.__wrap = () => {
    // keep boxes from the latest draw()
    if (typeof window.draw !== "function") return;
    const d = window.draw;
    window.draw = function () {
      frame = [];
      try {
        return d.apply(this, arguments);
      } finally {
        last = frame;
      }
    };
  };

  const pos = (e) => {
    const r = (
      document.querySelector("canvas") || document.body
    ).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (p) =>
    [...last]
      .reverse()
      .find(
        (s) => p.x >= s.b.x1 && p.x <= s.b.x2 && p.y >= s.b.y1 && p.y <= s.b.y2
      );
  addEventListener("mousedown", (e) => {
    const s = pick(pos(e));
    if (s) {
      drag = { id: s.id, x: s.x, y: s.y, p: pos(e) };
      document.body.style.cursor = "grabbing";
      e.preventDefault();
    }
  });
  addEventListener("mousemove", (e) => {
    const p = pos(e);
    if (!drag) {
      document.body.style.cursor = pick(p) ? "grab" : "default";
      return;
    }
    const x = Math.round(drag.x + p.x - drag.p.x),
      y = Math.round(drag.y + p.y - drag.p.y);
    ov[drag.id] = { x, y };
    parent.postMessage({ move: { id: drag.id, x, y } }, "*");
    if (typeof redraw === "function") redraw();
  });
  const drop = () => {
    drag = null;
    document.body.style.cursor = "default";
  };
  addEventListener("mouseup", drop);
  document.documentElement.addEventListener("mouseleave", drop);
  addEventListener("error", (e) => {
    if (e.message !== lastErr) {
      lastErr = e.message;
      parent.postMessage({ err: e.message }, "*");
    }
  });
}

let calls = {}; // sticker call id: where it sits in editor text

function run() {
  const src = $("editor").value;
  const names = [...src.matchAll(/function\s+(\w+)\s*\(\s*x\s*,\s*y\b/g)].map(
    (m) => m[1]
  );
  calls = {};
  let code = src;
  if (names.length) {
    // pencil(100, 120 > __s(17, pencil, 100, 120
    const re = new RegExp(
      String.raw`\b(${names.join(
        "|"
      )})\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)`,
      "g"
    );
    code = src.replace(re, (m, n, x, y, at) => {
      calls[at] = at;
      return `__s(${at}, ${n}, ${x}, ${y}`;
    });
  }
  $("runstatus").textContent = "running…";
  $("runstatus").className = "";
  code = code.replace(/<\/script/gi, "<\\/script");
  $("out").srcdoc =
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}</style>` +
    `<script src="${P5_SRC}"><\/script>` +
    `<script>(${runtime})()<\/script>` +
    `<script>${code}<\/script>` +
    `<script>__wrap(); addEventListener('load', () => parent.postMessage({ ok: true }, '*'));<\/script>`;
}

function nudge(id, x, y) {
  // rewrite the 2 numbers of 1 call in editor
  const ed = $("editor"),
    t = ed.value,
    at = calls[id];
  const re = /(\w+\(\s*)(-?\d+(?:\.\d+)?)(\s*,\s*)(-?\d+(?:\.\d+)?)/y;
  re.lastIndex = at;
  const m = re.exec(t);
  if (!m) return;
  const head = m[1] + x + m[3] + y,
    keep = ed.scrollTop;
  ed.value = t.slice(0, at) + head + t.slice(at + m[0].length);
  for (const k in calls)
    if (calls[k] > at) calls[k] += head.length - m[0].length;
  ed.scrollTop = keep;
  const top = 10 + t.slice(0, at).split("\n").length * 18 - 18; // bring changed line into view
  if (top < ed.scrollTop || top + 18 > ed.scrollTop + ed.clientHeight)
    ed.scrollTop = Math.max(0, top - ed.clientHeight / 2);
  paintEditor();
}

addEventListener("message", (e) => {
  if (e.source !== $("out").contentWindow) return;
  const st = $("runstatus");
  if (e.data.move) nudge(e.data.move.id, e.data.move.x, e.data.move.y);
  else if (e.data.err) {
    st.textContent = e.data.err;
    st.className = "err";
  } else if (e.data.ok && st.className !== "err") {
    st.textContent = "ran ok";
    st.className = "ok";
  }
});

function paintEditor() {
  // coloured copy of text behind textarea
  $("hl").innerHTML = $("editor").value.split("\n").map(hl).join("\n") + "\n";
  $("hl").scrollTop = $("editor").scrollTop;
  $("hl").scrollLeft = $("editor").scrollLeft;
}

let timer;
$("editor").value = STARTER;
$("editor").addEventListener("scroll", paintEditor);
$("editor").addEventListener("input", () => {
  paintEditor();
  clearTimeout(timer);
  timer = setTimeout(run, 350);
});
$("editor").addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    // keep focus in editor, insert 2 spaces
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    run();
  }
});

/* === controls === */

["rect", "ellipse", "triangle", "line"].forEach((t) => {
  const b = document.createElement("button");
  b.textContent = t;
  b.classList.toggle("on", t === tool);
  b.onclick = () => {
    tool = t;
    [...$("tools").children].forEach((c) => c.classList.toggle("on", c === b));
  };
  $("tools").append(b);
});

const HELP = {
  move: "drag a shape to move it to a new spot",
  rotate: "drag a corner to rotate a shape",
};
["draw", "move", "rotate"].forEach((m) => {
  const b = document.createElement("button");
  b.textContent = m;
  b.classList.toggle("on", m === mode);
  b.onclick = () => {
    mode = m;
    [...$("modes").children].forEach((c) => c.classList.toggle("on", c === b));
    $("tools").hidden = m !== "draw"; // shapes only matter while drawing
    $("movehelp").hidden = m === "draw";
    $("movehelp").textContent = HELP[m] || "";
    $("pad").classList.toggle("move", m === "move");
    $("pad").classList.toggle("rotate", m === "rotate");
  };
  $("modes").append(b);
});

COLOURS.forEach((c) => {
  const b = document.createElement("button");
  b.className = "sw";
  b.style.background = c;
  b.title = c;
  b.classList.toggle("on", c === colour);
  b.onclick = () => {
    colour = c;
    $("hex").textContent = c;
    [...$("swatches").children].forEach((x) =>
      x.classList.toggle("on", x === b)
    );
  };
  $("swatches").append(b);
});
$("hex").textContent = colour;

const nextIdea = () => {
  idea = (idea + 1) % IDEAS.length;
  $("idea").textContent = "// try: " + IDEAS[idea];
};
const undo = () => {
  if (shapes.length) undone.push(shapes.pop());
  renderCode();
};
const redo = () => {
  if (undone.length) shapes.push(undone.pop());
  renderCode();
};
$("another").onclick = nextIdea;
$("undo").onclick = undo;
$("redo").onclick = redo;
$("clear").onclick = () => {
  shapes = [];
  undone = [];
  renderCode();
};
$("stick").onclick = stickIt;
$("name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") stickIt();
});
$("name").addEventListener("input", () => renderCode());
addEventListener("keydown", (e) => {
  if (
    !(e.metaKey || e.ctrlKey) ||
    ["INPUT", "TEXTAREA"].includes(e.target.tagName)
  )
    return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((k === "z" && e.shiftKey) || k === "y") {
    e.preventDefault();
    redo();
  }
});

/* === drawing pad (p5.js, instance mode) === */

pad = new p5((p) => {
  const pt = () => ({
    x: Math.round(clamp(p.mouseX, 0, W)),
    y: Math.round(clamp(p.mouseY, 0, W)),
  });
  const inside = () =>
    p.mouseX >= 0 && p.mouseX <= W && p.mouseY >= 0 && p.mouseY <= W;
  const track = () => {
    $("status").textContent = inside()
      ? `x ${pt().x}  y ${pt().y}`
      : "x –  y –";
  };

  p.setup = () => {
    p.createCanvas(W, W);
    p.noLoop();
  };
  p.draw = () => paint(p, current());
  p.mouseMoved = track;
  p.mousePressed = () => {
    if (!inside()) return;
    if (mode !== "draw") {
      // pick up top-most shape under pointer
      const s = [...shapes].reverse().find((s) => hit(s, p.mouseX, p.mouseY));
      if (s && mode === "rotate") {
        const c = centre(s);
        moving = {
          s,
          turn: true,
          r0: s.r || 0,
          a0: Math.atan2(p.mouseY - c.y, p.mouseX - c.x),
        };
        $("pad").classList.add("moving");
      } else if (s) {
        moving = {
          s,
          o: JSON.parse(JSON.stringify(s)),
          x: p.mouseX,
          y: p.mouseY,
        };
        $("pad").classList.add("moving");
      }
      return;
    }
    drag = { a: pt(), b: pt() };
    renderCode();
  };
  p.mouseDragged = () => {
    if (moving && moving.turn) {
      // angle moved around centre in degrees
      const c = centre(moving.s),
        a = Math.atan2(p.mouseY - c.y, p.mouseX - c.x);
      moving.s.r =
        ((Math.round(moving.r0 + ((a - moving.a0) * 180) / Math.PI) % 360) +
          360) %
        360;
      renderCode();
    } else if (moving) {
      shift(
        moving.s,
        moving.o,
        Math.round(p.mouseX - moving.x),
        Math.round(p.mouseY - moving.y)
      );
      renderCode();
    } else if (drag) {
      drag.b = pt();
      renderCode();
    }
    track();
  };
  p.mouseReleased = () => {
    if (moving) {
      moving = null;
      $("pad").classList.remove("moving");
      return;
    }
    if (!drag) return;
    const s = shapeFrom(drag.a, drag.b);
    drag = null;
    const big =
      s.t === "line"
        ? Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 3
        : s.w > 3 && s.h > 3;
    if (big) {
      shapes.push(s);
      undone = [];
    }
    renderCode();
  };
}, $("pad"));

nextIdea();
renderCode();
renderCards();
paintEditor();
run();
