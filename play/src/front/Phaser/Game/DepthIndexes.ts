//this file contains all the depth indexes which will be used in our game

export const DEPTH_TILE_INDEX = 0;
//Note: Player characters use their y coordinate as their depth to simulate a perspective.
//See the Character class.
export const DEPTH_OVERLAY_INDEX = 1_000_000;
export const DEPTH_CONVERSATION_BUBBLE_INDEX = 1_050_000;
export const DEPTH_INGAME_TEXT_INDEX = 1_100_000;
//Emotes are DOM elements: Phaser turns their depth into a z-index, so they must sit above the name layer
//(DEPTH_INGAME_TEXT_INDEX) or every player name is drawn over them.
export const DEPTH_EMOTE_INDEX = DEPTH_INGAME_TEXT_INDEX + 1;
export const DEPTH_UI_INDEX = 1_200_000;
export const DEPTH_BUBBLE_CHAT_SPRITE = 9_999_999;
export const DEPTH_WHITE_MASK = 10_000_000;
