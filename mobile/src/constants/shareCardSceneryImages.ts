import type { ShareCardSceneryId } from './shareCardScenery';

/**
 * The bundled Scenery photographs (see shareCardScenery.ts). Kept apart from
 * the catalogue so code and tests that only need ids or overlay values never
 * load the image assets.
 */
export const SHARE_CARD_SCENERY_IMAGES: Record<ShareCardSceneryId, number> = {
  'misty-valley-sunrise': require('../../assets/share-backgrounds/scenery/01-misty-valley-sunrise.jpg'),
  'alpine-lake': require('../../assets/share-backgrounds/scenery/02-alpine-lake.jpg'),
  'foggy-rolling-hills': require('../../assets/share-backgrounds/scenery/03-foggy-rolling-hills.jpg'),
  'golden-mountain-sunset': require('../../assets/share-backgrounds/scenery/04-golden-mountain-sunset.jpg'),
  'forest-sunbeams': require('../../assets/share-backgrounds/scenery/05-forest-sunbeams.jpg'),
  'mossy-forest-path': require('../../assets/share-backgrounds/scenery/06-mossy-forest-path.jpg'),
  'morning-meadow': require('../../assets/share-backgrounds/scenery/07-morning-meadow.jpg'),
  'olive-grove': require('../../assets/share-backgrounds/scenery/08-olive-grove.jpg'),
  'ocean-horizon': require('../../assets/share-backgrounds/scenery/09-ocean-horizon.jpg'),
  'turquoise-shoreline': require('../../assets/share-backgrounds/scenery/10-turquoise-shoreline.jpg'),
  'mountain-lake-reflection': require('../../assets/share-backgrounds/scenery/11-mountain-lake-reflection.jpg'),
  'fern-waterfall': require('../../assets/share-backgrounds/scenery/12-fern-waterfall.jpg'),
  'golden-dunes': require('../../assets/share-backgrounds/scenery/13-golden-dunes.jpg'),
  'pastel-desert-sky': require('../../assets/share-backgrounds/scenery/14-pastel-desert-sky.jpg'),
  'soft-clouds': require('../../assets/share-backgrounds/scenery/15-soft-clouds.jpg'),
  'earth-tone-horizon': require('../../assets/share-backgrounds/scenery/16-earth-tone-horizon.jpg'),
  'wildflower-meadow': require('../../assets/share-backgrounds/scenery/17-wildflower-meadow.jpg'),
  'white-blossoms': require('../../assets/share-backgrounds/scenery/18-white-blossoms.jpg'),
  'lavender-field': require('../../assets/share-backgrounds/scenery/19-lavender-field.jpg'),
  'garden-path': require('../../assets/share-backgrounds/scenery/20-garden-path.jpg'),
  'pink-sakura': require('../../assets/share-backgrounds/scenery/21-pink-sakura.jpg'),
  'sakura-sky': require('../../assets/share-backgrounds/scenery/22-sakura-sky.jpg'),
  'pink-roses': require('../../assets/share-backgrounds/scenery/23-pink-roses.jpg'),
  'autumn-forest-path': require('../../assets/share-backgrounds/scenery/24-autumn-forest-path.jpg'),
  'autumn-lake': require('../../assets/share-backgrounds/scenery/25-autumn-lake.jpg'),
  'golden-autumn-valley': require('../../assets/share-backgrounds/scenery/26-golden-autumn-valley.jpg'),
  'sakura-pathway': require('../../assets/share-backgrounds/scenery/27-sakura-pathway.jpg'),
  'sakura-canopy': require('../../assets/share-backgrounds/scenery/28-sakura-canopy.jpg'),
  'sakura-lake': require('../../assets/share-backgrounds/scenery/29-sakura-lake.jpg'),
  'maple-path': require('../../assets/share-backgrounds/scenery/30-maple-path.jpg'),
  'golden-riverbank': require('../../assets/share-backgrounds/scenery/31-golden-riverbank.jpg'),
  'autumn-mountains': require('../../assets/share-backgrounds/scenery/32-autumn-mountains.jpg'),
  'snowy-forest-path': require('../../assets/share-backgrounds/scenery/33-snowy-forest-path.jpg'),
  'snowy-mountain-valley': require('../../assets/share-backgrounds/scenery/34-snowy-mountain-valley.jpg'),
  'winter-lake': require('../../assets/share-backgrounds/scenery/35-winter-lake.jpg'),
  'snowy-pines': require('../../assets/share-backgrounds/scenery/36-snowy-pines.jpg'),
  'fresh-snowfall': require('../../assets/share-backgrounds/scenery/37-fresh-snowfall.jpg'),
  'winter-dawn': require('../../assets/share-backgrounds/scenery/38-winter-dawn.jpg'),
};
