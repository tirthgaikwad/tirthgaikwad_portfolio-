// ==========================================
// HUB-CANVAS-TEMPLATES.JS — Ready-made starters for the planning canvas. Each one is built inside a frame, so it can be
// moved, renamed and shown in present mode. Ids here are placeholders: hub-canvas-extras.js gives every shape a new id.
// ==========================================

function cvTemplateKit() {
  let count = 0;
  const shapes = [];
  const add = (shape) => { shapes.push(shape); return shape; };
  const base = (type, x, y, w, h, text, color, extra) => add({ id: `tpl${++count}`, type, x, y, w, h, x2: 0, y2: 0, text: text || '', color: color || 'indigo', ...(extra || {}) });
  return {
    shapes,
    frame: (x, y, w, h, title) => base('frame', x, y, w, h, title, 'slate'),
    box: (type, x, y, w, h, text, color, extra) => base(type, x, y, w, h, text, color, extra),
    sticky: (x, y, text, color) => base('sticky', x, y, 160, 110, text, color || 'amber'),
    title: (x, y, w, text, color) => base('text', x, y, w, 40, text, color || 'black', { font: 'L', align: 'left' }),
    link: (from, to, extra) => add({
      id: `tpl${++count}`, type: 'arrow', x: from.x + from.w / 2, y: from.y + from.h / 2, x2: to.x + to.w / 2, y2: to.y + to.h / 2,
      w: 0, h: 0, text: '', color: 'slate', start_id: from.id, end_id: to.id, ...(extra || {})
    })
  };
}

const CANVAS_TEMPLATES = [
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'Start, steps, a yes/no decision and an end, already connected.',
    build() {
      const k = cvTemplateKit();
      k.frame(0, 0, 820, 560, 'Flowchart');
      const start = k.box('circle', 60, 60, 120, 70, 'Start', 'green');
      const step = k.box('rectangle', 250, 55, 170, 80, 'First step', 'indigo');
      const decide = k.box('diamond', 500, 40, 190, 110, 'Is it ready?', 'amber');
      const yes = k.box('rectangle', 510, 260, 170, 80, 'Ship it', 'indigo');
      const no = k.box('rectangle', 250, 260, 170, 80, 'Fix and recheck', 'indigo');
      const end = k.box('circle', 535, 430, 120, 70, 'End', 'rose');
      k.link(start, step);
      k.link(step, decide);
      k.link(decide, yes, { label: 'Yes' });
      k.link(decide, no, { label: 'No', route: 'elbow' });
      k.link(no, step);
      k.link(yes, end);
      return k.shapes;
    }
  },
  {
    id: 'swot',
    name: 'SWOT',
    description: 'Strengths, weaknesses, opportunities and threats in four boxes.',
    build() {
      const k = cvTemplateKit();
      k.frame(0, 0, 840, 640, 'SWOT analysis');
      [['Strengths', 'green', 30, 30], ['Weaknesses', 'rose', 430, 30], ['Opportunities', 'sky', 30, 330], ['Threats', 'amber', 430, 330]].forEach(([name, color, x, y]) => {
        k.box('rectangle', x, y, 380, 280, '', color, { fill: 'light' });
        k.title(x + 16, y + 12, 300, name, color);
        k.sticky(x + 20, y + 70, 'Add a point', color);
        k.sticky(x + 200, y + 70, 'Add a point', color);
      });
      return k.shapes;
    }
  },
  {
    id: 'journey',
    name: 'User journey',
    description: 'What someone does, thinks and feels at each stage of using your project.',
    build() {
      const k = cvTemplateKit();
      const stages = ['Discover', 'Sign up', 'First use', 'Every day', 'Share'];
      k.frame(0, 0, 160 + stages.length * 190 + 20, 520, 'User journey');
      stages.forEach((stage, i) => k.box('rectangle', 160 + i * 190, 30, 170, 56, stage, 'indigo', { fill: 'solid' }));
      [['Doing', 'sky'], ['Thinking', 'violet'], ['Feeling', 'amber']].forEach(([row, color], r) => {
        k.title(24, 130 + r * 130, 120, row, 'black');
        stages.forEach((stage, i) => { if ((i + r) % 2 === 0) k.box('sticky', 165 + i * 190, 110 + r * 130, 160, 100, '', color); });
      });
      return k.shapes;
    }
  },
  {
    id: 'architecture',
    name: 'System design',
    description: 'Apps, an API, a database, a cache and outside services, wired together.',
    build() {
      const k = cvTemplateKit();
      k.frame(0, 0, 900, 520, 'System design');
      const web = k.box('rectangle', 50, 70, 170, 80, 'Web app', 'sky');
      const mobile = k.box('rectangle', 50, 300, 170, 80, 'Mobile app', 'sky');
      const api = k.box('hexagon', 340, 175, 190, 100, 'API server', 'indigo');
      const db = k.box('database', 650, 50, 150, 130, 'Database', 'green');
      const cache = k.box('database', 650, 300, 150, 130, 'Cache', 'teal');
      const auth = k.box('rectangle', 350, 380, 170, 70, 'Sign-in service', 'violet');
      k.link(web, api);
      k.link(mobile, api);
      k.link(api, db, { head_start: 'triangle' });
      k.link(api, cache, { dash: 'dashed' });
      k.link(api, auth);
      return k.shapes;
    }
  },
  {
    id: 'retro',
    name: 'Retro',
    description: 'What went well, what to improve and the actions to take next.',
    build() {
      const k = cvTemplateKit();
      k.frame(0, 0, 820, 540, 'Sprint retro');
      [['Went well', 'green'], ['To improve', 'rose'], ['Actions', 'indigo']].forEach(([name, color], i) => {
        const x = 30 + i * 265;
        k.box('rectangle', x, 30, 245, 56, name, color, { fill: 'solid' });
        k.sticky(x + 42, 110, '', color === 'indigo' ? 'sky' : color);
        k.sticky(x + 42, 240, '', color === 'indigo' ? 'sky' : color);
      });
      return k.shapes;
    }
  },
  {
    id: 'impact',
    name: 'Impact vs effort',
    description: 'Sort ideas into quick wins, big bets, fill-ins and time sinks.',
    build() {
      const k = cvTemplateKit();
      k.frame(0, 0, 820, 640, 'Impact vs effort');
      [['Quick wins', 'green', 70, 30], ['Big bets', 'sky', 440, 30], ['Fill-ins', 'slate', 70, 320], ['Time sinks', 'rose', 440, 320]].forEach(([name, color, x, y]) => {
        k.box('rectangle', x, y, 350, 270, '', color, { fill: 'light', corners: 'sharp' });
        k.title(x + 14, y + 10, 260, name, color);
      });
      k.box('arrow', 50, 600, 0, 0, '', 'black', { x2: 50, y2: 30, label: 'Impact' });
      k.box('arrow', 50, 610, 0, 0, '', 'black', { x2: 800, y2: 610, label: 'Effort' });
      k.sticky(110, 110, 'Idea', 'amber');
      return k.shapes;
    }
  },
  {
    id: 'week',
    name: 'Weekly plan',
    description: 'One column per day, with notes to move around as plans change.',
    build() {
      const k = cvTemplateKit();
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      k.frame(0, 0, 30 + days.length * 200, 480, 'This week');
      days.forEach((day, i) => {
        const x = 30 + i * 200;
        k.box('rectangle', x, 30, 180, 50, day, 'indigo', { fill: 'solid' });
        k.box('sticky', x + 10, 100, 160, 100, '', i % 2 ? 'amber' : 'green');
      });
      return k.shapes;
    }
  }
];
