# Teleport Extension Module

This extension module adds a custom "Teleport" area property to the WorkAdventure map editor, allowing you to teleport people to another universe/world/room.

## Features

- **Custom Area Property**: Add a teleport property to any area in the map editor
- **Universe/World/Room Navigation**: Specify the destination using universe, world, and room fields
- **Optional Start Area**: Optionally specify a start area using the `#startArea` format
- **URL Preview**: See a preview of the generated URL as you type
- **Validation**: Required fields (universe, world, room) are validated

## Installation

1. The teleport extension module is located in `play/src/front/external-modules/teleport/`

2. To enable it, add `"teleport"` to the `modules` array in your room metadata:

```json
{
  "modules": ["teleport"]
}
```

Or if you're using the Admin API, ensure the room's metadata includes the teleport module.

## Usage

1. Open the map editor
2. Select an area
3. Click "Add Property" and select "Teleport"
4. Fill in the required fields:
   - **Universe**: e.g., `bawes-univ`
   - **World**: e.g., `bawes-world`
   - **Room**: e.g., `headquarters`
   - **Start Area** (optional): e.g., `startSpawnArea`
5. The URL will be generated in the format: `@/universe/world/room#startArea`

## Example

- Universe: `bawes-univ`
- World: `bawes-world`
- Room: `headquarters`
- Start Area: `creative-bridge`

Results in: `@/bawes-univ/bawes-world/headquarters#creative-bridge`

## Technical Details

- The teleport property uses the same navigation mechanism as exit areas
- Uses `Room.getRoomPathFromExitUrl()` to parse and navigate to the destination
- The property is stored as an `extensionModule` type with subtype `"teleport"`
- Data is stored in the property's `data` field as a JSON object

## Notes

- The extension module pattern allows you to add custom functionality without modifying upstream code
- The teleport extension is automatically registered when the module is loaded

