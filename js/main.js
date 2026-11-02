'use strict';
/* Bootstrap & main loop. */

(function main() {
  const canvas = document.getElementById('world');
  const game = new Game();
  const view = new View();
  const ui = new UI(game, view);
  const input = new Input(canvas, game, view, ui);
  const renderer = new Renderer(canvas, game, view, ui, input);

  const offline = game.load();
  ui.centerOnHub();
  if (offline < 0) {
    ui.toast('Welcome! Open 🎯 Goals for your first task.', 'big');
  } else if (offline > 60) {
    ui.toast(`Welcome back — ${Math.round(offline / 60)} min of production simulated`, 'good');
  }

  // autosave
  setInterval(() => game.save(), 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });
  addEventListener('pagehide', () => game.save());

  let last = performance.now(), acc = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 1) { game.simulate(Math.min(dt, BALANCE.offlineCapSec)); dt = 0.1; } // tab was in background
    else acc += dt;
    let steps = 0;
    while (acc >= BALANCE.tick && steps++ < 10) { game.tick(BALANCE.tick, true); acc -= BALANCE.tick; }
    if (steps >= 10) acc = 0;
    input.update(dt);
    ui.update(dt);
    renderer.draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.ioio = { game, view, ui, input, renderer }; // for tinkering in the dev console
})();
