import { ReactNode } from 'react';

/* ============================================================
   STICKERS — large categorized library (expanded from the
   original 40 to 150+, all rendered as text glyphs so they
   scale cleanly and cost nothing).
   ============================================================ */

export type StickerCategory =
  | 'hearts'
  | 'flowers'
  | 'stars'
  | 'nature'
  | 'weather'
  | 'food'
  | 'coffee'
  | 'travel'
  | 'love'
  | 'celebration'
  | 'cute'
  | 'animals'
  | 'decorations'
  | 'tape'
  | 'paper'
  | 'frames'
  | 'doodles'
  | 'arrows'
  | 'shapes'
  | 'seasonal';

export interface Sticker {
  value: string;
  label: string;
  className?: string;
}

export const STICKER_LIBRARY: Record<StickerCategory, Sticker[]> = {
  hearts: [
    { value: '♥', label: 'Heart', className: 'text-rose-500' },
    { value: '♡', label: 'Heart outline', className: 'text-rose-400' },
    { value: '❤️', label: 'Red heart' },
    { value: '🧡', label: 'Orange heart' },
    { value: '💛', label: 'Yellow heart' },
    { value: '💚', label: 'Green heart' },
    { value: '💙', label: 'Blue heart' },
    { value: '💜', label: 'Purple heart' },
    { value: '🖤', label: 'Black heart' },
    { value: '🤍', label: 'White heart' },
    { value: '💕', label: 'Two hearts' },
    { value: '💖', label: 'Sparkle heart' },
    { value: '💗', label: 'Growing heart' },
    { value: '💘', label: 'Heart arrow' },
    { value: '💞', label: 'Revolving hearts' },
    { value: '💓', label: 'Beating heart' },
    { value: '❣️', label: 'Heart exclamation', className: 'text-rose-600' },
    { value: '💔', label: 'Broken heart' },
  ],
  flowers: [
    { value: '✿', label: 'Flower', className: 'text-pink-500' },
    { value: '❁', label: 'Daisy', className: 'text-pink-400' },
    { value: '❋', label: 'Blossom', className: 'text-fuchsia-500' },
    { value: '🌹', label: 'Rose' },
    { value: '🌸', label: 'Cherry blossom' },
    { value: '🌺', label: 'Hibiscus' },
    { value: '🌻', label: 'Sunflower' },
    { value: '🌷', label: 'Tulip' },
    { value: '🌼', label: 'Blossom' },
    { value: '💮', label: 'White flower' },
    { value: '🏵️', label: 'Rosette' },
    { value: '💐', label: 'Bouquet' },
    { value: '🪷', label: 'Lotus' },
    { value: '❀', label: 'Outline flower', className: 'text-pink-500' },
  ],
  stars: [
    { value: '★', label: 'Star', className: 'text-yellow-500' },
    { value: '☆', label: 'Star outline', className: 'text-yellow-500' },
    { value: '✦', label: 'Sparkle', className: 'text-amber-400' },
    { value: '✧', label: 'Twinkle', className: 'text-amber-400' },
    { value: '✶', label: 'Spark', className: 'text-yellow-500' },
    { value: '✴️', label: 'Eight pointed' },
    { value: '⭐', label: 'Star' },
    { value: '🌟', label: 'Glowing star' },
    { value: '✨', label: 'Sparkles' },
    { value: '💫', label: 'Dizzy' },
    { value: '☄️', label: 'Comet' },
    { value: '🔆', label: 'Bright' },
  ],
  nature: [
    { value: '🌿', label: 'Herb' },
    { value: '🍀', label: 'Clover' },
    { value: '🌱', label: 'Seedling' },
    { value: '🍃', label: 'Leaves' },
    { value: '🍂', label: 'Fallen leaves' },
    { value: '🍁', label: 'Maple leaf' },
    { value: '🌴', label: 'Palm tree' },
    { value: '🌲', label: 'Evergreen' },
    { value: '🌵', label: 'Cactus' },
    { value: '🪴', label: 'Potted plant' },
    { value: '🌾', label: 'Sheaf of rice' },
    { value: '🌱', label: 'Sprout' },
  ],
  weather: [
    { value: '☀️', label: 'Sun' },
    { value: '☾', label: 'Moon', className: 'text-indigo-500' },
    { value: '🌙', label: 'Crescent moon' },
    { value: '☁', label: 'Cloud', className: 'text-sky-400' },
    { value: '⛅', label: 'Sun behind cloud' },
    { value: '🌧️', label: 'Rain' },
    { value: '⛈️', label: 'Storm' },
    { value: '❄', label: 'Snowflake', className: 'text-sky-400' },
    { value: '❄️', label: 'Snowflake' },
    { value: '🌈', label: 'Rainbow' },
    { value: '⚡', label: 'Lightning' },
    { value: '🌫️', label: 'Fog' },
    { value: '🌪️', label: 'Tornado' },
  ],
  food: [
    { value: '🍓', label: 'Strawberry' },
    { value: '🍰', label: 'Cake' },
    { value: '🧁', label: 'Cupcake' },
    { value: '🍪', label: 'Cookie' },
    { value: '🍩', label: 'Doughnut' },
    { value: '🍎', label: 'Apple' },
    { value: '🍒', label: 'Cherries' },
    { value: '🍑', label: 'Peach' },
    { value: '🍉', label: 'Watermelon' },
    { value: '🍇', label: 'Grapes' },
    { value: '🥑', label: 'Avocado' },
    { value: '🍞', label: 'Bread' },
    { value: '🧇', label: 'Waffle' },
    { value: '🍯', label: 'Honey' },
    { value: '🍭', label: 'Lollipop' },
    { value: '🍫', label: 'Chocolate' },
  ],
  coffee: [
    { value: '☕', label: 'Coffee' },
    { value: '🍵', label: 'Tea' },
    { value: '🧋', label: 'Bubble tea' },
    { value: '🥤', label: 'Cup with straw' },
    { value: '🍶', label: 'Sake' },
    { value: '🫖', label: 'Teapot' },
    { value: '🍪', label: 'Coffee cookie' },
    { value: '☕️', label: 'Small coffee' },
  ],
  travel: [
    { value: '✈️', label: 'Plane' },
    { value: '🚗', label: 'Car' },
    { value: '🚲', label: 'Bicycle' },
    { value: '🚂', label: 'Train' },
    { value: '🛸', label: 'UFO' },
    { value: '🗺️', label: 'Map' },
    { value: '🧭', label: 'Compass' },
    { value: '🏝️', label: 'Island' },
    { value: '🏔️', label: 'Mountain' },
    { value: '🎡', label: 'Ferris wheel' },
    { value: '🗼', label: 'Tower' },
    { value: '🚢', label: 'Ship' },
  ],
  love: [
    { value: '💌', label: 'Love letter' },
    { value: '🌹', label: 'Rose' },
    { value: '🥰', label: 'In love' },
    { value: '😘', label: 'Kiss' },
    { value: '💍', label: 'Ring' },
    { value: '👩‍❤️‍👨', label: 'Couple' },
    { value: '👩‍❤️‍👩', label: 'Couple' },
    { value: '👨‍❤️‍👨', label: 'Couple' },
    { value: '💞', label: 'Revolving hearts' },
    { value: '_coords_', label: '' }, // placeholder filtered below
  ],
  celebration: [
    { value: '🎉', label: 'Party popper' },
    { value: '🎊', label: 'Confetti' },
    { value: '🎈', label: 'Balloon' },
    { value: '🎁', label: 'Gift' },
    { value: '🎂', label: 'Birthday cake' },
    { value: '🥳', label: 'Partying' },
    { value: '🍾', label: 'Champagne' },
    { value: '✨', label: 'Sparkles' },
    { value: '🎆', label: 'Fireworks' },
    { value: '🎇', label: 'Sparkler' },
  ],
  cute: [
    { value: '🦋', label: 'Butterfly' },
    { value: '🎀', label: 'Ribbon' },
    { value: '🧸', label: 'Teddy bear' },
    { value: '🐻', label: 'Bear' },
    { value: '🐰', label: 'Rabbit' },
    { value: '🐱', label: 'Cat' },
    { value: '🐶', label: 'Dog' },
    { value: '🐹', label: 'Hamster' },
    { value: '🦊', label: 'Fox' },
    { value: '🐼', label: 'Panda' },
    { value: '🐰', label: 'Bunny 2' },
    { value: '🐣', label: 'Chick' },
    { value: '☁️', label: 'Cloud puff' },
    { value: '🌸', label: 'Cherry' },
    { value: '⭐', label: 'Star' },
    { value: '🌙', label: 'Moon' },
  ],
  animals: [
    { value: '🐝', label: 'Bee' },
    { value: '🐞', label: 'Ladybug' },
    { value: '🦔', label: 'Hedgehog' },
    { value: '🦉', label: 'Owl' },
    { value: '🐺', label: 'Wolf' },
    { value: '🦄', label: 'Unicorn' },
    { value: '🐢', label: 'Turtle' },
    { value: '🦕', label: 'Dinosaur' },
    { value: '🐙', label: 'Octopus' },
    { value: '🦚', label: 'Peacock' },
    { value: '🐬', label: 'Dolphin' },
    { value: '🐳', label: 'Whale' },
  ],
  decorations: [
    { value: '📌', label: 'Pin' },
    { value: '📎', label: 'Paperclip' },
    { value: '🔖', label: 'Bookmark' },
    { value: '🗝️', label: 'Old key' },
    { value: '🔑', label: 'Key' },
    { value: '💡', label: 'Light bulb' },
    { value: '🔮', label: 'Crystal ball' },
    { value: '🕯️', label: 'Candle' },
    { value: '🪞', label: 'Mirror' },
    { value: '🧶', label: 'Yarn' },
  ],
  tape: [
    { value: '▭', label: 'Tape strip', className: 'text-amber-300' },
    { value: '▬', label: 'Wide tape', className: 'text-rose-300' },
    { value: '▨', label: 'Pattern tape', className: 'text-emerald-300' },
    { value: '⬓', label: 'Tape square', className: 'text-sky-300' },
    { value: '╱╲', label: 'Corner tape', className: 'text-amber-400' },
    { value: '═', label: 'Tape line', className: 'text-stone-400' },
  ],
  paper: [
    { value: '📄', label: 'Page' },
    { value: '📃', label: 'Page with curl' },
    { value: '📑', label: 'Bookmark tabs' },
    { value: '🗒️', label: 'Spiral notepad' },
    { value: '🗓️', label: 'Spiral calendar' },
    { value: '📇', label: 'Card index' },
    { value: '📋', label: 'Clipboard' },
    { value: '📈', label: 'Chart' },
    { value: '✉', label: 'Envelope', className: 'text-slate-600' },
    { value: '✉️', label: 'Envelope' },
    { value: '📨', label: 'Incoming envelope' },
    { value: '📧', label: 'Email' },
  ],
  frames: [
    { value: '▢', label: 'Frame', className: 'text-stone-500' },
    { value: '▤', label: 'Lined frame', className: 'text-stone-400' },
    { value: '▣', label: 'Filled frame', className: 'text-stone-600' },
    { value: '🖼️', label: 'Picture frame' },
    { value: '🎞️', label: 'Film frame' },
    { value: '🔲', label: 'Frame square' },
  ],
  doodles: [
    { value: '✎', label: 'Pencil', className: 'text-stone-600' },
    { value: '✏️', label: 'Pencil' },
    { value: '🖊️', label: 'Pen' },
    { value: '🖌️', label: 'Brush' },
    { value: '🖍️', label: 'Crayon' },
    { value: '✐', label: 'Pencil 2', className: 'text-stone-600' },
    { value: '✑', label: 'Pen nib', className: 'text-stone-500' },
    { value: 'ϟ', label: 'Zigzag', className: 'text-amber-500' },
  ],
  arrows: [
    { value: '➜', label: 'Arrow right', className: 'text-stone-600' },
    { value: '➤', label: 'Arrow head', className: 'text-stone-600' },
    { value: '➔', label: 'Simple arrow', className: 'text-stone-600' },
    { value: '↝', label: 'Curved arrow', className: 'text-stone-500' },
    { value: '⤴', label: 'Arrow up', className: 'text-stone-500' },
    { value: '⤵', label: 'Arrow down', className: 'text-stone-500' },
    { value: '↺', label: 'Rotate left', className: 'text-stone-500' },
    { value: '↻', label: 'Rotate right', className: 'text-stone-500' },
  ],
  shapes: [
    { value: '◼', label: 'Square', className: 'text-stone-500' },
    { value: '◻', label: 'Square outline', className: 'text-stone-400' },
    { value: '●', label: 'Circle', className: 'text-stone-500' },
    { value: '○', label: 'Circle outline', className: 'text-stone-400' },
    { value: '▲', label: 'Triangle', className: 'text-stone-500' },
    { value: '△', label: 'Triangle outline', className: 'text-stone-400' },
    { value: '◆', label: 'Diamond', className: 'text-stone-500' },
    { value: '◇', label: 'Diamond outline', className: 'text-stone-400' },
    { value: '⬟', label: 'Pentagon', className: 'text-stone-500' },
    { value: '⬢', label: 'Hexagon', className: 'text-stone-500' },
  ],
  seasonal: [
    { value: '🎃', label: 'Halloween' },
    { value: '🦃', label: 'Thanksgiving' },
    { value: '🎄', label: 'Christmas tree' },
    { value: '🎅', label: 'Santa' },
    { value: '🕎', label: 'Menorah' },
    { value: '🧨', label: 'Firecracker' },
    { value: '🪔', label: 'Diya' },
    { value: '🎊', label: 'New year' },
    { value: '☘️', label: 'St patrick' },
    { value: '🥚', label: 'Easter' },
  ],
};

// remove any accidental placeholder entries (safety)
for (const cat of Object.keys(STICKER_LIBRARY) as StickerCategory[]) {
  STICKER_LIBRARY[cat] = STICKER_LIBRARY[cat].filter((s) => s.label && s.value !== '_coords_');
}

export const STICKER_CATEGORY_LABELS: Record<StickerCategory, string> = {
  hearts: 'Hearts',
  flowers: 'Flowers',
  stars: 'Stars',
  nature: 'Nature',
  weather: 'Weather',
  food: 'Food',
  coffee: 'Coffee',
  travel: 'Travel',
  love: 'Love',
  celebration: 'Celebration',
  cute: 'Cute',
  animals: 'Animals',
  decorations: 'Decorations',
  tape: 'Tape',
  paper: 'Paper',
  frames: 'Frames',
  doodles: 'Doodles',
  arrows: 'Arrows',
  shapes: 'Shapes',
  seasonal: 'Seasonal',
};

/* ============================================================
   ICONS — small inline SVG icon set for journal decoration.
   Behave like normal canvas elements.
   ============================================================ */

export interface IconMeta {
  id: string;
  label: string;
  keywords: string[];
  /** SVG path data (24x24 viewbox) */
  paths: string[];
}

export const ICON_LIBRARY: IconMeta[] = [
  { id: 'heart', label: 'Heart', keywords: ['love', 'heart'], paths: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'] },
  { id: 'star', label: 'Star', keywords: ['favorite', 'rate'], paths: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'] },
  { id: 'cloud', label: 'Cloud', keywords: ['weather', 'sky'], paths: ['M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'] },
  { id: 'sun', label: 'Sun', keywords: ['weather', 'day'], paths: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.22 4.22l1.42 1.42', 'M18.36 18.36l1.42 1.42', 'M1 12h2', 'M21 12h2', 'M4.22 19.78l1.42-1.42', 'M18.36 5.64l1.42-1.42'] },
  { id: 'moon', label: 'Moon', keywords: ['night', 'sleep'], paths: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'] },
  { id: 'leaf', label: 'Leaf', keywords: ['nature', 'plant'], paths: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'] },
  { id: 'flower', label: 'Flower', keywords: ['nature', 'spring'], paths: ['M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1', 'M12 21a9 9 0 0 0 9-9'] },
  { id: 'feather', label: 'Feather', keywords: ['quill', 'write', 'bird'], paths: ['M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z', 'M16 8L2 22', 'M17.5 15H9'] },
  { id: 'camera', label: 'Camera', keywords: ['photo', 'picture'], paths: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'], },
  { id: 'music', label: 'Music', keywords: ['song', 'note'], paths: ['M9 18V5l12-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'] },
  { id: 'coffee', label: 'Coffee', keywords: ['cup', 'drink', 'cafe'], paths: ['M18 8h1a4 4 0 0 1 0 8h-1', 'M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z'] },
  { id: 'plane', label: 'Plane', keywords: ['travel', 'trip'], paths: ['M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'] },
  { id: 'anchor', label: 'Anchor', keywords: ['ship', 'sea'], paths: ['M12 22V8', 'M5 12H2a10 10 0 0 0 20 0h-3', 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'] },
  { id: 'map-pin', label: 'Pin', keywords: ['location', 'place'], paths: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'] },
  { id: 'compass', label: 'Compass', keywords: ['direction', 'navigate'], paths: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'] },
  { id: 'book', label: 'Book', keywords: ['read', 'journal'], paths: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'] },
  { id: 'pen', label: 'Pen', keywords: ['write', 'edit'], paths: ['M12 19l7-7 3 3-7 7-3-3z', 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z', 'M2 2l7.586 7.586', 'M11 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0z'] },
  { id: 'gift', label: 'Gift', keywords: ['present', 'birthday'], paths: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'] },
  { id: 'bell', label: 'Bell', keywords: ['alarm', 'notification'], paths: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'] },
  { id: 'key', label: 'Key', keywords: ['lock', 'secret'], paths: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'] },
  { id: 'lock', label: 'Lock', keywords: ['secure', 'private'], paths: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'] },
  { id: 'home', label: 'House', keywords: ['house', 'cozy'], paths: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'] },
  { id: 'umbrella', label: 'Umbrella', keywords: ['rain', 'weather'], paths: ['M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7'] },
  { id: 'snowflake', label: 'Snowflake', keywords: ['winter', 'cold'], paths: ['M12 2v20', 'M17 5H7', 'M16 8l-8 8', 'M8 8l8 8', 'M7 19h10'] },
  { id: 'cat', label: 'Cat', keywords: ['animal', 'pet'], paths: ['M12 21a8 8 0 0 0 8-8V5l-3 3h-2l-3-3-3 3H7L4 5v8a8 8 0 0 0 8 8z', 'M9 13h.01', 'M15 13h.01'] },
  { id: 'dog', label: 'Dog', keywords: ['animal', 'pet'], paths: ['M10 5.5a2.5 2.5 0 0 0-5 0A7.5 7.5 0 0 0 5 13l-2 2 2 5h4l1-3h4l1 3h4l2-5-2-2a7.5 7.5 0 0 0 0-7.5 2.5 2.5 0 0 0-5 0z', 'M10 5.5V9', 'M14 5.5V9', 'M9 12h.01', 'M15 12h.01'] },
  { id: 'rabbit', label: 'Rabbit', keywords: ['animal', 'bunny'], paths: ['M12 21a8 8 0 0 0 8-8c0-2-1-4-2-5', 'M6 8C5 9 4 11 4 13a8 8 0 0 0 8 8', 'M9 8c0-3 1-6 3-6s3 3 3 6', 'M9 4c-2 0-3 2-3 4'] },
  { id: 'bird', label: 'Bird', keywords: ['animal', 'fly'], paths: ['M16 7h.01', 'M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20', 'M20 7l2 .5-2 .5', 'M10 18v3', 'M14 17.75V21', 'M7 18a6 6 0 0 0 3.84-10.61'] },
  { id: 'fish', label: 'Fish', keywords: ['animal', 'sea'], paths: ['M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6z', 'M18 12v.5', 'M16 17.93a9.77 9.77 0 0 1 0-11.86', 'M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33', 'M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4'] },
  { id: 'tree', label: 'Tree', keywords: ['nature', 'forest'], paths: ['M12 3l5 7h-3l4 6h-4l3 5H7l3-5H6l4-6H7z', 'M12 21v-3'] },
  { id: 'mountain', label: 'Mountain', keywords: ['peak', 'adventure'], paths: ['M8 3l4 8 5-5 5 15H2L8 3z'] },
  { id: 'rocket', label: 'Rocket', keywords: ['space', 'launch'], paths: ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z', 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0', 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'] },
  { id: 'palette', label: 'Palette', keywords: ['art', 'color'], paths: ['M12 22a10 10 0 1 1 10-10c0 4.5-3.5 4-5 4s-3 1-3 2.5 1 3.5-2 3.5z', 'M7.5 10.5h.01', 'M12 7.5h.01', 'M16.5 10.5h.01'] },
  { id: 'scissors', label: 'Scissors', keywords: ['cut', 'craft'], paths: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4L8.12 15.88', 'M14.47 14.48L20 20', 'M8.12 8.12L12 12'] },
];

export interface IconCategory {
  id: string;
  label: string;
  icon: ReactNode;
  icons: IconMeta[];
}

/* ============================================================
   EMOJIS — full picker data with search + categories + recents.
   ============================================================ */

export type EmojiCategory =
  | 'smileys'
  | 'gestures'
  | 'animals'
  | 'food'
  | 'travel'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

export interface EmojiGroup {
  category: EmojiCategory;
  label: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    category: 'smileys',
    label: 'Smileys & people',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡', '👹', '👺', '👻', '👽', '🤖', '😺', '😸', '😹', '😻', '😽', '😼', '🙀', '😿', '😾'],
  },
  {
    category: 'gestures',
    label: 'Gestures',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦'],
  },
  {
    category: 'animals',
    label: 'Animals & nature',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🦆', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🐘', '🦛', '🐪', '🦒', '🦘', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🍃', '🍂', '🍁', '🌺', '🌻', '🌹', '🌷', '🌸', '💐', '🌾', '🌙', '⭐', '🌟', '✨', '⚡', '🔥', '🌈', '☀️', '⛅', '☁️', '🌧️', '⛈️', '❄️', '🌊'],
  },
  {
    category: 'food',
    label: 'Food & drink',
    emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉'],
  },
  {
    category: 'travel',
    label: 'Travel & places',
    emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🛴', '🚲', '🛵', '🏍️', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🚧', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🛕', '🕍', '⛩️', '🕋'],
  },
  {
    category: 'activities',
    label: 'Activities',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🚴', '🚵', '🧗', '🏇', '🏊', '🏄', '🚣', '🧘', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  },
  {
    category: 'objects',
    label: 'Objects',
    emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💽', '💾', '💿', '📀', '🧮', '🎥', '📷', '📹', '📼', '🔍', '🔎', '🕯️', '💡', '🔌', '🔋', '🧯', '🛢️', '💸', '💵', '💰', '🧾', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪛', '🔩', '⚙️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚿', '🛁', '🪥', '🪒', '🧼', '🪣', '🧽', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🧸', '🪆', '🖼️', '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '🪧', '📪', '📫', '📬', '📮', '📜', '📃', '📄', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍'],
  },
  {
    category: 'symbols',
    label: 'Symbols',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', '♾️', '💲', '💱', '™️', '©️', '®️', '👁️‍🗨️', '💭', '💬', '🗯️', '🕳️'],
  },
  {
    category: 'flags',
    label: 'Flags',
    emojis: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇳🇿', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇵🇹', '🇳🇱', '🇧🇪', '🇨🇭', '🇦🇹', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇮🇸', '🇮🇪', '🇵🇱', '🇨🇿', '🇸🇰', '🇭🇺', '🇷🇴', '🇬🇷', '🇹🇷', '🇷🇺', '🇺🇦', '🇧🇷', '🇦🇷', '🇨🇱', '🇨🇴', '🇵🇪', '🇲🇽', '🇦🇷', '🇿🇦', '🇳🇬', '🇰🇪', '🇪🇬', '🇲🇦', '🇮🇳', '🇵🇰', '🇧🇩', '🇱🇰', '🇳🇵', '🇨🇳', '🇯🇵', '🇰🇷', '🇰🇵', '🇹🇼', '🇭🇰', '🇸🇬', '🇲🇾', '🇹🇭', '🇻🇳', '🇵🇭', '🇮🇩', '🇸🇦', '🇦🇪', '🇶🇦', '🇮🇱', '🇮🇷', '🇮🇶', '🇯🇴', '🇱🇧', '🇸🇾'],
  },
];

export const EMOJI_CATEGORY_LABELS: Record<EmojiCategory, string> = {
  smileys: 'Smileys',
  gestures: 'People',
  animals: 'Animals',
  food: 'Food',
  travel: 'Travel',
  activities: 'Activity',
  objects: 'Objects',
  symbols: 'Symbols',
  flags: 'Flags',
};

/* ============================================================
   CHAT THEMES — predefined palette users can apply to
   conversations (persisted per user + conversation).
   ============================================================ */

export interface ChatTheme {
  id: string;
  name: string;
  background: string;
  backgroundUrl?: string;
  bubbleMine: string;
  bubbleTheirs: string;
  textMine: string;
  textTheirs: string;
  accent: string;
  bubbleStyle: 'rounded' | 'pill' | 'square' | 'bubble';
  fontFamily?: string;
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: 'classic',
    name: 'Classic',
    background: '#FFF7F8',
    bubbleMine: '#2A211D',
    bubbleTheirs: '#FFFFFF',
    textMine: '#FFF7F8',
    textTheirs: '#111111',
    accent: '#E5798F',
    bubbleStyle: 'rounded',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#0F172A',
    bubbleMine: '#6D28D9',
    bubbleTheirs: '#1E293B',
    textMine: '#F8FAFC',
    textTheirs: '#E2E8F0',
    accent: '#8B5CF6',
    bubbleStyle: 'rounded',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    background: 'linear-gradient(160deg,#FFF1E6 0%,#FFE1EC 100%)',
    bubbleMine: '#EA580C',
    bubbleTheirs: '#FFFFFF',
    textMine: '#FFF7ED',
    textTheirs: '#431407',
    accent: '#F97316',
    bubbleStyle: 'pill',
  },
  {
    id: 'forest',
    name: 'Forest',
    background: '#ECFDF5',
    bubbleMine: '#047857',
    bubbleTheirs: '#FFFFFF',
    textMine: '#ECFDF5',
    textTheirs: '#022C22',
    accent: '#10B981',
    bubbleStyle: 'rounded',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: 'linear-gradient(160deg,#E0F2FE 0%,#EDE9FE 100%)',
    bubbleMine: '#1D4ED8',
    bubbleTheirs: '#FFFFFF',
    textMine: '#EFF6FF',
    textTheirs: '#172554',
    accent: '#3B82F6',
    bubbleStyle: 'pill',
  },
  {
    id: 'rose',
    name: 'Rose',
    background: 'linear-gradient(160deg,#FFF1F2 0%,#FECDD3 60%)',
    bubbleMine: '#BE123C',
    bubbleTheirs: '#FFFFFF',
    textMine: '#FFF1F2',
    textTheirs: '#4C0519',
    accent: '#FB7185',
    bubbleStyle: 'bubble',
  },
  {
    id: 'paper',
    name: 'Paper',
    background: '#FAF6EF',
    bubbleMine: '#57534E',
    bubbleTheirs: '#FFFFFF',
    textMine: '#FAF6EF',
    textTheirs: '#292524',
    accent: '#D97706',
    bubbleStyle: 'square',
  },
  {
    id: 'candy',
    name: 'Candy',
    background: 'linear-gradient(160deg,#FDF2F8 0%,#F5D0FE 100%)',
    bubbleMine: '#C026D3',
    bubbleTheirs: '#FFFFFF',
    textMine: '#FDF4FF',
    textTheirs: '#701A75',
    accent: '#E879F9',
    bubbleStyle: 'pill',
  },
];

/* ============================================================
   GIF / external service configuration
   ============================================================ */

export type GifProvider = 'tenor' | 'giphy' | 'none';

export const GIF_PROVIDER: GifProvider =
  (process.env.NEXT_PUBLIC_GIF_PROVIDER as GifProvider) || 'none';
