/* Ratio Dash avatars — DiceBear pixel-art (CC0, no attribution needed).
   Every player gets one built from a random seed picked when they join and
   stored on their player entry, so every client renders the same avatar
   for the same player. Google profile photos are deliberately not used. */

import { createAvatar } from "@dicebear/core";
import * as pixelArt from "@dicebear/pixel-art";

const cache = new Map();

export function avatarUrlForPlayer(player){
  const seed = player.avatarSeed || player.uid;
  if(!cache.has(seed)){
    cache.set(seed, createAvatar(pixelArt, { seed }).toDataUri());
  }
  return cache.get(seed);
}
