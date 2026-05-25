import './style.css';
import { Game } from './game/simulation/game';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('App root not found');
}

const game = new Game(root);
game.start();
