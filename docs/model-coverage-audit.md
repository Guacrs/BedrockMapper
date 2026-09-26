# Model geometry coverage audit (PR38)

Catalog size: **1505** block ids (appearance ∪ block-colors).

## Buckets

| Bucket | Count | Meaning |
| --- | ---: | --- |
| explicit_ok | 489 | Dedicated model family already |
| intentional_full_cube | 779 | True / intentional cube mesh |
| intentional_fallback | 13 | Safe full-cube stand-in (J) |
| known_incorrect | 202 | Non-cube evidence; still cube mesh |
| suspected_incorrect | 22 | Heuristic non-cube; needs research |

**Incorrect / suspected total: 224** (plus 13 intentional fallbacks).

## Priority backlog (incorrect + fallback)

| Priority | Count | Role |
| --- | ---: | --- |
| p0 | 36 | High-frequency build visuals (hanging signs, chests, chains, campfires) |
| p1 | 32 | Attachment / redstone / thin deco |
| p2 | 46 | Functional furniture / rods |
| p3 | 80 | Vegetation / clusters / cakes (incl. candle cakes) |
| p4 | 43 | Rare / complex / heuristic |

Floor candles (PR39) and standing/wall signs (PR40) are **explicit_ok**. Next family PR starts at **PR41** (hanging signs).

## Suggested family PR sequence

Do **not** implement this list blindly — each PR still needs Bedrock state research.
One family (or tightly related group) per PR.

### P0 — `hanging_sign` (13 ids) → candidate PR41

Samples: `minecraft:acacia_hanging_sign`, `minecraft:bamboo_hanging_sign`, `minecraft:birch_hanging_sign`, `minecraft:cherry_hanging_sign`, `minecraft:crimson_hanging_sign`, `minecraft:dark_oak_hanging_sign`, `minecraft:jungle_hanging_sign`, `minecraft:mangrove_hanging_sign`

### P0 — `chest` (11 ids) → candidate PR42

Samples: `minecraft:chest`, `minecraft:copper_chest`, `minecraft:ender_chest`, `minecraft:exposed_copper_chest`, `minecraft:oxidized_copper_chest`, `minecraft:trapped_chest`, `minecraft:waxed_copper_chest`, `minecraft:waxed_exposed_copper_chest`

### P0 — `chain` (10 ids) → candidate PR43

Samples: `minecraft:chain`, `minecraft:copper_chain`, `minecraft:exposed_copper_chain`, `minecraft:iron_chain`, `minecraft:oxidized_copper_chain`, `minecraft:waxed_copper_chain`, `minecraft:waxed_exposed_copper_chain`, `minecraft:waxed_oxidized_copper_chain`

### P0 — `campfire` (2 ids) → candidate PR44

Samples: `minecraft:campfire`, `minecraft:soul_campfire`

### P1 — `fence_gate` (13 ids) → candidate PR45

Samples: `minecraft:acacia_fence_gate`, `minecraft:bamboo_fence_gate`, `minecraft:birch_fence_gate`, `minecraft:cherry_fence_gate`, `minecraft:crimson_fence_gate`, `minecraft:dark_oak_fence_gate`, `minecraft:fence_gate`, `minecraft:jungle_fence_gate`

### P1 — `piston` (6 ids) → candidate PR46

Samples: `minecraft:movingBlock`, `minecraft:piston`, `minecraft:piston_arm_collision`, `minecraft:pistonArmCollision`, `minecraft:sticky_piston`, `minecraft:sticky_piston_arm_collision`

### P1 — `repeater_comparator` (4 ids) → candidate PR47

Samples: `minecraft:powered_comparator`, `minecraft:powered_repeater`, `minecraft:unpowered_comparator`, `minecraft:unpowered_repeater`

### P1 — `banner` (2 ids) → candidate PR48

Samples: `minecraft:standing_banner`, `minecraft:wall_banner`

### P1 — `daylight_detector` (2 ids) → candidate PR49

Samples: `minecraft:daylight_detector`, `minecraft:daylight_detector_inverted`

### P1 — `redstone_wire` (2 ids) → candidate PR50

Samples: `minecraft:redstone_wire`, `minecraft:trip_wire`

### P1 — `flower_pot` (1 ids) → candidate PR51

Samples: `minecraft:flower_pot`

### P1 — `lily_pad` (1 ids) → candidate PR52

Samples: `minecraft:waterlily`

### P1 — `tripwire_hook` (1 ids) → candidate PR53

Samples: `minecraft:tripwire_hook`

### P2 — `shulker` (18 ids) → candidate PR54

Samples: `minecraft:black_shulker_box`, `minecraft:blue_shulker_box`, `minecraft:brown_shulker_box`, `minecraft:cyan_shulker_box`, `minecraft:gray_shulker_box`, `minecraft:green_shulker_box`, `minecraft:light_blue_shulker_box`, `minecraft:light_gray_shulker_box`

### P2 — `rod` (9 ids) → candidate PR55

Samples: `minecraft:end_rod`, `minecraft:exposed_lightning_rod`, `minecraft:lightning_rod`, `minecraft:oxidized_lightning_rod`, `minecraft:waxed_exposed_lightning_rod`, `minecraft:waxed_lightning_rod`, `minecraft:waxed_oxidized_lightning_rod`, `minecraft:waxed_weathered_lightning_rod`

### P2 — `anvil` (4 ids) → candidate PR56

Samples: `minecraft:anvil`, `minecraft:chipped_anvil`, `minecraft:damaged_anvil`, `minecraft:deprecated_anvil`

### P2 — `bed` (2 ids) → candidate PR57

Samples: `minecraft:bed`, `minecraft:straw_bed`

### P2 — `cauldron` (2 ids) → candidate PR58

Samples: `minecraft:cauldron`, `minecraft:lava_cauldron`

### P2 — `barrel` (1 ids) → candidate PR59

Samples: `minecraft:barrel`

### P2 — `bell` (1 ids) → candidate PR60

Samples: `minecraft:bell`

### P2 — `brewing_stand` (1 ids) → candidate PR61

Samples: `minecraft:brewing_stand`

### P2 — `chiseled_bookshelf` (1 ids) → candidate PR62

Samples: `minecraft:chiseled_bookshelf`

### P2 — `composter` (1 ids) → candidate PR63

Samples: `minecraft:composter`

### P2 — `decorated_pot` (1 ids) → candidate PR64

Samples: `minecraft:decorated_pot`

### P2 — `enchanting_table` (1 ids) → candidate PR65

Samples: `minecraft:enchanting_table`

### P2 — `grindstone` (1 ids) → candidate PR66

Samples: `minecraft:grindstone`

### P2 — `hopper` (1 ids) → candidate PR67

Samples: `minecraft:hopper`

### P2 — `lectern` (1 ids) → candidate PR68

Samples: `minecraft:lectern`

### P2 — `scaffolding` (1 ids) → candidate PR69

Samples: `minecraft:scaffolding`

### P3 — `coral_fan` (25 ids) → candidate PR70

Samples: `minecraft:brain_coral_fan`, `minecraft:brain_coral_wall_fan`, `minecraft:bubble_coral_fan`, `minecraft:bubble_coral_wall_fan`, `minecraft:coral_fan`, `minecraft:coral_fan_dead`, `minecraft:coral_fan_hang`, `minecraft:coral_fan_hang2`

### P3 — `candle` (17 ids) → candidate PR71

Samples: `minecraft:black_candle_cake`, `minecraft:blue_candle_cake`, `minecraft:brown_candle_cake`, `minecraft:candle_cake`, `minecraft:cyan_candle_cake`, `minecraft:gray_candle_cake`, `minecraft:green_candle_cake`, `minecraft:light_blue_candle_cake`

### P3 — `double_plant` (15 ids) → candidate PR72

Samples: `minecraft:cactus_flower`, `minecraft:dried_kelp_block`, `minecraft:kelp`, `minecraft:large_fern`, `minecraft:lilac`, `minecraft:peony`, `minecraft:pink_petals`, `minecraft:pitcher_crop`

### P3 — `skull` (8 ids) → candidate PR73

Samples: `minecraft:creeper_head`, `minecraft:dragon_head`, `minecraft:piglin_head`, `minecraft:player_head`, `minecraft:skeleton_skull`, `minecraft:skull`, `minecraft:wither_skeleton_skull`, `minecraft:zombie_head`

### P3 — `vine_hanging` (8 ids) → candidate PR74

Samples: `minecraft:cave_vines`, `minecraft:cave_vines_body_with_berries`, `minecraft:cave_vines_head_with_berries`, `minecraft:hanging_roots`, `minecraft:pale_hanging_moss`, `minecraft:twisting_vines`, `minecraft:vine`, `minecraft:weeping_vines`

### P3 — `amethyst` (4 ids) → candidate PR75

Samples: `minecraft:amethyst_cluster`, `minecraft:large_amethyst_bud`, `minecraft:medium_amethyst_bud`, `minecraft:small_amethyst_bud`

### P3 — `bamboo_plant` (1 ids) → candidate PR76

Samples: `minecraft:bamboo`

### P3 — `cake` (1 ids) → candidate PR77

Samples: `minecraft:cake`

### P3 — `dripstone` (1 ids) → candidate PR78

Samples: `minecraft:pointed_dripstone`

### P4 — `heuristic_other` (22 ids) → candidate PR79

Samples: `minecraft:acacia_shelf`, `minecraft:bamboo_shelf`, `minecraft:birch_shelf`, `minecraft:cherry_shelf`, `minecraft:copper_bulb`, `minecraft:crimson_shelf`, `minecraft:dark_oak_shelf`, `minecraft:exposed_copper_bulb`

### P4 — `other_researched` (18 ids) → candidate PR80

Samples: `minecraft:conduit`, `minecraft:copper_golem_statue`, `minecraft:crafter`, `minecraft:dried_ghast`, `minecraft:end_portal_frame`, `minecraft:exposed_copper_golem_statue`, `minecraft:frame`, `minecraft:glow_frame`

### P4 — `egg` (3 ids) → candidate PR81

Samples: `minecraft:frog_spawn`, `minecraft:sniffer_egg`, `minecraft:turtle_egg`

## Lighting

Deferred until the model-coverage milestone. Next lighting phase is **research / BlockLight extraction**, not ad-hoc emissive tweaks.

## Full incorrect / fallback inventory

| Priority | Category | Bucket | Block |
| --- | --- | --- | --- |
| p0 | campfire | known_incorrect | `minecraft:campfire` |
| p0 | campfire | known_incorrect | `minecraft:soul_campfire` |
| p0 | chain | known_incorrect | `minecraft:chain` |
| p0 | chain | known_incorrect | `minecraft:copper_chain` |
| p0 | chain | known_incorrect | `minecraft:exposed_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:iron_chain` |
| p0 | chain | known_incorrect | `minecraft:oxidized_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:waxed_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:waxed_exposed_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:waxed_oxidized_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:waxed_weathered_copper_chain` |
| p0 | chain | known_incorrect | `minecraft:weathered_copper_chain` |
| p0 | chest | known_incorrect | `minecraft:chest` |
| p0 | chest | known_incorrect | `minecraft:copper_chest` |
| p0 | chest | known_incorrect | `minecraft:ender_chest` |
| p0 | chest | known_incorrect | `minecraft:exposed_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:oxidized_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:trapped_chest` |
| p0 | chest | known_incorrect | `minecraft:waxed_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:waxed_exposed_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:waxed_oxidized_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:waxed_weathered_copper_chest` |
| p0 | chest | known_incorrect | `minecraft:weathered_copper_chest` |
| p0 | hanging_sign | known_incorrect | `minecraft:acacia_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:bamboo_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:birch_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:cherry_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:crimson_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:dark_oak_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:jungle_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:mangrove_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:oak_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:pale_oak_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:poplar_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:spruce_hanging_sign` |
| p0 | hanging_sign | known_incorrect | `minecraft:warped_hanging_sign` |
| p1 | banner | known_incorrect | `minecraft:standing_banner` |
| p1 | banner | known_incorrect | `minecraft:wall_banner` |
| p1 | daylight_detector | known_incorrect | `minecraft:daylight_detector` |
| p1 | daylight_detector | known_incorrect | `minecraft:daylight_detector_inverted` |
| p1 | fence_gate | intentional_fallback | `minecraft:acacia_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:bamboo_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:birch_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:cherry_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:crimson_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:dark_oak_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:jungle_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:mangrove_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:pale_oak_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:poplar_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:spruce_fence_gate` |
| p1 | fence_gate | intentional_fallback | `minecraft:warped_fence_gate` |
| p1 | flower_pot | known_incorrect | `minecraft:flower_pot` |
| p1 | lily_pad | known_incorrect | `minecraft:waterlily` |
| p1 | piston | known_incorrect | `minecraft:movingBlock` |
| p1 | piston | known_incorrect | `minecraft:piston` |
| p1 | piston | known_incorrect | `minecraft:piston_arm_collision` |
| p1 | piston | known_incorrect | `minecraft:pistonArmCollision` |
| p1 | piston | known_incorrect | `minecraft:sticky_piston` |
| p1 | piston | known_incorrect | `minecraft:sticky_piston_arm_collision` |
| p1 | redstone_wire | known_incorrect | `minecraft:redstone_wire` |
| p1 | redstone_wire | known_incorrect | `minecraft:trip_wire` |
| p1 | repeater_comparator | known_incorrect | `minecraft:powered_comparator` |
| p1 | repeater_comparator | known_incorrect | `minecraft:powered_repeater` |
| p1 | repeater_comparator | known_incorrect | `minecraft:unpowered_comparator` |
| p1 | repeater_comparator | known_incorrect | `minecraft:unpowered_repeater` |
| p1 | tripwire_hook | known_incorrect | `minecraft:tripwire_hook` |
| p2 | anvil | known_incorrect | `minecraft:anvil` |
| p2 | anvil | known_incorrect | `minecraft:chipped_anvil` |
| p2 | anvil | known_incorrect | `minecraft:damaged_anvil` |
| p2 | anvil | known_incorrect | `minecraft:deprecated_anvil` |
| p2 | barrel | known_incorrect | `minecraft:barrel` |
| p2 | bed | known_incorrect | `minecraft:bed` |
| p2 | bed | known_incorrect | `minecraft:straw_bed` |
| p2 | bell | known_incorrect | `minecraft:bell` |
| p2 | brewing_stand | known_incorrect | `minecraft:brewing_stand` |
| p2 | cauldron | known_incorrect | `minecraft:cauldron` |
| p2 | cauldron | known_incorrect | `minecraft:lava_cauldron` |
| p2 | chiseled_bookshelf | known_incorrect | `minecraft:chiseled_bookshelf` |
| p2 | composter | known_incorrect | `minecraft:composter` |
| p2 | decorated_pot | known_incorrect | `minecraft:decorated_pot` |
| p2 | enchanting_table | known_incorrect | `minecraft:enchanting_table` |
| p2 | grindstone | known_incorrect | `minecraft:grindstone` |
| p2 | hopper | known_incorrect | `minecraft:hopper` |
| p2 | lectern | known_incorrect | `minecraft:lectern` |
| p2 | rod | known_incorrect | `minecraft:end_rod` |
| p2 | rod | known_incorrect | `minecraft:exposed_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:oxidized_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:waxed_exposed_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:waxed_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:waxed_oxidized_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:waxed_weathered_lightning_rod` |
| p2 | rod | known_incorrect | `minecraft:weathered_lightning_rod` |
| p2 | scaffolding | known_incorrect | `minecraft:scaffolding` |
| p2 | shulker | known_incorrect | `minecraft:black_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:blue_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:brown_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:cyan_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:gray_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:green_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:light_blue_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:light_gray_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:lime_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:magenta_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:orange_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:pink_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:purple_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:red_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:undyed_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:white_shulker_box` |
| p2 | shulker | known_incorrect | `minecraft:yellow_shulker_box` |
| p3 | amethyst | known_incorrect | `minecraft:amethyst_cluster` |
| p3 | amethyst | known_incorrect | `minecraft:large_amethyst_bud` |
| p3 | amethyst | known_incorrect | `minecraft:medium_amethyst_bud` |
| p3 | amethyst | known_incorrect | `minecraft:small_amethyst_bud` |
| p3 | bamboo_plant | known_incorrect | `minecraft:bamboo` |
| p3 | cake | known_incorrect | `minecraft:cake` |
| p3 | candle | known_incorrect | `minecraft:black_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:blue_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:brown_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:candle_cake` |
| p3 | candle | known_incorrect | `minecraft:cyan_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:gray_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:green_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:light_blue_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:light_gray_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:lime_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:magenta_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:orange_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:pink_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:purple_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:red_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:white_candle_cake` |
| p3 | candle | known_incorrect | `minecraft:yellow_candle_cake` |
| p3 | coral_fan | known_incorrect | `minecraft:brain_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:brain_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:bubble_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:bubble_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:coral_fan_dead` |
| p3 | coral_fan | known_incorrect | `minecraft:coral_fan_hang` |
| p3 | coral_fan | known_incorrect | `minecraft:coral_fan_hang2` |
| p3 | coral_fan | known_incorrect | `minecraft:coral_fan_hang3` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_brain_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_brain_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_bubble_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_bubble_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_fire_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_fire_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_horn_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_horn_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_tube_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:dead_tube_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:fire_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:fire_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:horn_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:horn_coral_wall_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:tube_coral_fan` |
| p3 | coral_fan | known_incorrect | `minecraft:tube_coral_wall_fan` |
| p3 | double_plant | known_incorrect | `minecraft:cactus_flower` |
| p3 | double_plant | known_incorrect | `minecraft:dried_kelp_block` |
| p3 | double_plant | known_incorrect | `minecraft:kelp` |
| p3 | double_plant | known_incorrect | `minecraft:large_fern` |
| p3 | double_plant | known_incorrect | `minecraft:lilac` |
| p3 | double_plant | known_incorrect | `minecraft:peony` |
| p3 | double_plant | known_incorrect | `minecraft:pink_petals` |
| p3 | double_plant | known_incorrect | `minecraft:pitcher_crop` |
| p3 | double_plant | known_incorrect | `minecraft:pitcher_plant` |
| p3 | double_plant | known_incorrect | `minecraft:rose_bush` |
| p3 | double_plant | known_incorrect | `minecraft:seagrass` |
| p3 | double_plant | known_incorrect | `minecraft:sunflower` |
| p3 | double_plant | known_incorrect | `minecraft:sweet_berry_bush` |
| p3 | double_plant | known_incorrect | `minecraft:tall_grass` |
| p3 | double_plant | known_incorrect | `minecraft:wildflowers` |
| p3 | dripstone | known_incorrect | `minecraft:pointed_dripstone` |
| p3 | skull | known_incorrect | `minecraft:creeper_head` |
| p3 | skull | known_incorrect | `minecraft:dragon_head` |
| p3 | skull | known_incorrect | `minecraft:piglin_head` |
| p3 | skull | known_incorrect | `minecraft:player_head` |
| p3 | skull | known_incorrect | `minecraft:skeleton_skull` |
| p3 | skull | known_incorrect | `minecraft:skull` |
| p3 | skull | known_incorrect | `minecraft:wither_skeleton_skull` |
| p3 | skull | known_incorrect | `minecraft:zombie_head` |
| p3 | vine_hanging | known_incorrect | `minecraft:cave_vines` |
| p3 | vine_hanging | known_incorrect | `minecraft:cave_vines_body_with_berries` |
| p3 | vine_hanging | known_incorrect | `minecraft:cave_vines_head_with_berries` |
| p3 | vine_hanging | known_incorrect | `minecraft:hanging_roots` |
| p3 | vine_hanging | known_incorrect | `minecraft:pale_hanging_moss` |
| p3 | vine_hanging | known_incorrect | `minecraft:twisting_vines` |
| p3 | vine_hanging | known_incorrect | `minecraft:vine` |
| p3 | vine_hanging | known_incorrect | `minecraft:weeping_vines` |
| p4 | egg | known_incorrect | `minecraft:frog_spawn` |
| p4 | egg | known_incorrect | `minecraft:sniffer_egg` |
| p4 | egg | known_incorrect | `minecraft:turtle_egg` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:acacia_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:bamboo_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:birch_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:cherry_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:crimson_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:dark_oak_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:exposed_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:jungle_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:mangrove_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:oak_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:oxidized_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:pale_oak_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:poplar_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:shelf_mushroom` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:spruce_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:warped_shelf` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:waxed_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:waxed_exposed_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:waxed_oxidized_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:waxed_weathered_copper_bulb` |
| p4 | heuristic_other | suspected_incorrect | `minecraft:weathered_copper_bulb` |
| p4 | other_researched | known_incorrect | `minecraft:conduit` |
| p4 | other_researched | known_incorrect | `minecraft:copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:crafter` |
| p4 | other_researched | known_incorrect | `minecraft:dried_ghast` |
| p4 | other_researched | known_incorrect | `minecraft:end_portal_frame` |
| p4 | other_researched | known_incorrect | `minecraft:exposed_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:frame` |
| p4 | other_researched | known_incorrect | `minecraft:glow_frame` |
| p4 | other_researched | known_incorrect | `minecraft:heavy_core` |
| p4 | other_researched | known_incorrect | `minecraft:mob_spawner` |
| p4 | other_researched | known_incorrect | `minecraft:oxidized_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:trial_spawner` |
| p4 | other_researched | known_incorrect | `minecraft:vault` |
| p4 | other_researched | known_incorrect | `minecraft:waxed_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:waxed_exposed_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:waxed_oxidized_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:waxed_weathered_copper_golem_statue` |
| p4 | other_researched | known_incorrect | `minecraft:weathered_copper_golem_statue` |
