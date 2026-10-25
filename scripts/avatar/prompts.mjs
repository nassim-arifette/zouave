// Visual description derived from Wikimedia Commons photos of the statue (see REFERENCES).
export const STATUE =
  "the Zouave statue of Pont de l'Alma in Paris (sculpted in 1856 by Georges Diebolt): a 19th-century " +
  "French zouave infantryman, gaunt bony face with high cheekbones, short curly beard and moustache, " +
  "gaze lifted slightly upward and to his left as if watching the river, a soft zouave chechia cap " +
  "wrapped close to the head with a tassel falling to one side, a heavy hooded cloak (burnous) draped " +
  "over both shoulders, a short embroidered zouave jacket over a waistcoat, his right hand raised to " +
  "his chest clutching the edge of the cloak";

const AVATAR =
  "Square avatar composition for a round profile picture: head and shoulders only, cropped at mid-chest, " +
  "the face is large and centered in the frame with some headroom, plain dark navy blue (#0b1a33) " +
  "background, no text, no watermark, no frame.";

export const OPTIONS = [
  {
    id: 1,
    label: "Weathered stone bust",
    prompt:
      `Photorealistic portrait of ${STATUE}. Keep the real statue's likeness from the reference photos. ` +
      "Pale grey limestone with fine carved detail, erosion, green-black Seine water stains and lichen, " +
      "dramatic cool rim light and soft key light, sharp museum-quality photography. " + AVATAR,
  },
  {
    id: 2,
    label: "Living-stone 3D character",
    prompt:
      `Stylized 3D animated-film character render (Pixar-like) of a living stone statue based on ${STATUE}. ` +
      "Keep the costume and silhouette of the reference statue but make him warm, friendly and slightly " +
      "cheeky: a knowing half-smile, one eyebrow raised, expressive eyes, still clearly carved from pale grey " +
      "limestone with visible stone texture and tiny cracks. Soft warm studio light with a subtle teal rim " +
      "light. " + AVATAR,
  },
  {
    id: 3,
    label: "Flat vector mascot",
    prompt:
      `Flat vector illustration mascot of ${STATUE}, simplified into bold clean geometric shapes with ` +
      "thick dark outlines and minimal flat shading. Palette: warm stone grey and cream for the statue, a " +
      "muted red chechia with its tassel, a teal Seine water wave across the bottom edge. Cheerful, " +
      "friendly expression. Sticker-like app icon style. " + AVATAR,
  },
  {
    id: 4,
    label: "Bronze, flood at shoulders",
    prompt:
      `Heroic cinematic portrait of ${STATUE}, rendered as a bronze sculpture with a golden patina and ` +
      "verdigris. He is half submerged like during the 1910 Seine flood: dark river water reaches exactly up " +
      "to his shoulders, only the head, beard and top of the shoulders rise above the surface, with circular " +
      "ripples and glowing reflections around his neck. Night, warm key light and cool blue fill. " + AVATAR,
  },
];

// Downloaded at runtime from Wikimedia Commons (not committed).
export const REFERENCES = [
  { title: "File:Un zouave à Paris.JPG", license: "CC0", author: "Brigitte Alliot" },
  { title: "File:Le zouave au pont de l'Alma à Paris.JPG", license: "CC BY-SA 3.0", author: "Thesupermat" },
];

// Mouth region (x0, y0, x1, y1) in the 1024x1024 option images, used for the speaking frame.
export const MOUTH_BOXES = {
  1: [430, 272, 600, 380],
  2: [440, 282, 630, 392],
  4: [445, 276, 605, 382],
};
