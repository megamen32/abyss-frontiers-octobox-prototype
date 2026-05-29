import './style.css';
import { Game } from './game/simulation/game';
import { BoidsBenchmark } from './benchmark/BoidsBenchmark';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('App root not found');
}

const params = new URLSearchParams(window.location.search);

if (params.get('benchmark') === '1') {
  const benchmark = new BoidsBenchmark(root);
  benchmark.start();
} else {
  const game = new Game(root);
  game.start();
}
