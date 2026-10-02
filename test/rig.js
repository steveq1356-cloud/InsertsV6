// Shared test rig: a GRBL Link wired to the virtual controller, stepped in fixed time.
'use strict';
module.exports = function rig(IP, opts) {
  const G = IP.grbl;
  opts = opts || {};
  const queue = [];
  const sim = new IP.VirtualGrbl({ onLine: (l) => queue.push(l), probe: opts.probe, g54: opts.g54 || [0, 0, 0], log: [] });
  const link = new G.Link({ write: (l) => sim.receive(l + '\n'), writeByte: (b) => sim.receive(b) });
  const clock = { t: 0 };
  const flush = () => { while (queue.length) link.receive(queue.shift(), clock.t); };
  let n = 0;
  const step = (dt) => {
    if (n++ % 10 === 0) sim.receive(0x3f);
    sim.tick(dt); clock.t += dt * 1000; flush();
    link.tick(clock.t);
  };
  flush();
  const run = async (until, seconds, each) => {
    for (let i = 0; i < seconds / 0.02 && !until(); i++) {
      step(0.02);
      if (each) each();
      if (i % 5 === 0) await null;
    }
    await null;
  };
  const autoStart = () => {
    const c = link.streamer.current();
    if (link.machine.state === 'Hold' && link.streamer.state === 'running' && c && c.kind === 'pause') link.streamer.cycleStart();
  };
  const sent = () => sim.log.join('').split('\n');
  return { sim, link, flush, step, run, autoStart, clock, sent };
};
