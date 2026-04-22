import { generateBoard, RESOURCES } from './board.js';

export const PLAYER_COLORS = ['#e84e4e', '#4e8ce8', '#e8e0c8', '#e89a3c'];
export const PLAYER_NAMES_DEFAULT = ['你', 'AI 红胡', 'AI 白袍', 'AI 橙帽'];

export const DEV_CARD_TYPES = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];

export const Phase = {
  SETUP_1_SETTLEMENT: 'SETUP_1_SETTLEMENT',
  SETUP_1_ROAD: 'SETUP_1_ROAD',
  SETUP_2_SETTLEMENT: 'SETUP_2_SETTLEMENT',
  SETUP_2_ROAD: 'SETUP_2_ROAD',
  ROLL: 'ROLL',
  DISCARD: 'DISCARD',
  MOVE_ROBBER: 'MOVE_ROBBER',
  STEAL: 'STEAL',
  MAIN: 'MAIN',
  ROAD_BUILDING_1: 'ROAD_BUILDING_1',
  ROAD_BUILDING_2: 'ROAD_BUILDING_2',
  GAME_OVER: 'GAME_OVER'
};

function emptyResources() {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

function emptyDevCards() {
  return { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
}

function buildDevDeck() {
  const deck = [];
  for (let i = 0; i < 14; i++) deck.push('knight');
  for (let i = 0; i < 2; i++) deck.push('roadBuilding');
  for (let i = 0; i < 2; i++) deck.push('yearOfPlenty');
  for (let i = 0; i < 2; i++) deck.push('monopoly');
  for (let i = 0; i < 5; i++) deck.push('victoryPoint');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createInitialState(numPlayers = 4, aiMask = [false, true, true, true], seed) {
  const board = generateBoard(seed);
  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    players.push({
      id: i,
      name: PLAYER_NAMES_DEFAULT[i] || `玩家${i+1}`,
      color: PLAYER_COLORS[i],
      isAI: !!aiMask[i],
      resources: emptyResources(),
      devCards: emptyDevCards(),
      newDevCards: emptyDevCards(),
      playedKnights: 0,
      playedDevCardThisTurn: false,
      settlementsLeft: 5,
      citiesLeft: 4,
      roadsLeft: 15,
      portAccess: new Set()
    });
  }

  return {
    board,
    players,
    phase: Phase.SETUP_1_SETTLEMENT,
    currentPlayer: 0,
    setupDirection: 1,
    buildings: {},
    roads: {},
    robberHex: board.robberHex,
    dice: [0, 0],
    lastRoll: null,
    log: [],
    winner: null,
    longestRoadOwner: null,
    longestRoadLength: 4,
    largestArmyOwner: null,
    largestArmySize: 2,
    devDeck: buildDevDeck(),
    pendingDiscards: {},
    lastSetupVertex: null,
    roadBuildingPlaced: 0,
    turnNumber: 0
  };
}

export function getPlayer(state, id) {
  return state.players[id];
}

export function totalCards(res) {
  return (res.wood || 0) + (res.brick || 0) + (res.sheep || 0) + (res.wheat || 0) + (res.ore || 0);
}

export function totalDevCards(dc) {
  return DEV_CARD_TYPES.reduce((s, t) => s + (dc[t] || 0), 0);
}
