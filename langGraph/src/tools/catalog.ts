import { tool } from "@langchain/core/tools";
import type { OxViewCDPSession } from "../runtime/cdpSession.js";
import {
  CenterOfMassInputSchema,
  ColorElementsInputSchema,
  DistanceInputSchema,
  EmptyInputSchema,
  FindElementsInputSchema,
  FocusElementInputSchema,
  GetElementInfoInputSchema,
  SceneSummaryInputSchema,
  SelectElementsInputSchema,
  ToggleVisibilityInputSchema,
} from "./schemas.js";

export type OxViewToolDefinition = {
  name: string;
  description: string;
  mutation: boolean;
  tool: any;
};

function withEnvelope(
  mutation: boolean,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return {
    mutation,
    ...result,
  };
}

export function createOxViewTools(session: OxViewCDPSession) {
  const definitions: OxViewToolDefinition[] = [
    {
      name: "get_scene_summary",
      description:
        "Fetch the current oxView scene summary, including element count, selection, camera type, coloring mode, and recent API errors.",
      mutation: false,
      tool: tool(
        async (input) =>
          withEnvelope(false, await session.runHelper("getSceneSummary", input)),
        {
          name: "get_scene_summary",
          description:
            "Read-only tool for fetching the current oxView scene summary.",
          schema: SceneSummaryInputSchema,
        },
      ),
    },
    {
      name: "get_api_errors",
      description:
        "Fetch the last oxView API error and recent API error history.",
      mutation: false,
      tool: tool(
        async () => withEnvelope(false, await session.runHelper("getApiErrors", {})),
        {
          name: "get_api_errors",
          description: "Read-only tool for querying visible oxView API errors.",
          schema: EmptyInputSchema,
        },
      ),
    },
    {
      name: "find_elements",
      description:
        "Resolve a typed element filter into matching oxView element ids.",
      mutation: false,
      tool: tool(
        async (input) =>
          withEnvelope(false, await session.runHelper("findElements", input)),
        {
          name: "find_elements",
          description:
            "Read-only tool for resolving filters like ids, parity, strand ids, selected elements, base types, and attribute predicates into element ids.",
          schema: FindElementsInputSchema,
        },
      ),
    },
    {
      name: "get_element_info",
      description:
        "Fetch a serializable info object for a single element id, including positions and orientation.",
      mutation: false,
      tool: tool(
        async (input) =>
          withEnvelope(false, { info: await session.runHelper("getElementInfo", input) }),
        {
          name: "get_element_info",
          description:
            "Read-only tool for fetching positions, ids, strand info, and orientation for a single element.",
          schema: GetElementInfoInputSchema,
        },
      ),
    },
    {
      name: "get_distance",
      description:
        "Measure the distance between two elements using center, backbone, base, connector, or backboneConnector positions.",
      mutation: false,
      tool: tool(
        async (input) =>
          withEnvelope(false, await session.runHelper("getDistance", input)),
        {
          name: "get_distance",
          description:
            "Read-only tool for measuring distance between two elements.",
          schema: DistanceInputSchema,
        },
      ),
    },
    {
      name: "get_center_of_mass",
      description:
        "Compute the center of mass for a typed filter of elements.",
      mutation: false,
      tool: tool(
        async (input) =>
          withEnvelope(false, await session.runHelper("getCenterOfMass", input)),
        {
          name: "get_center_of_mass",
          description:
            "Read-only tool for computing the center of mass of filtered elements.",
          schema: CenterOfMassInputSchema,
        },
      ),
    },
    {
      name: "select_elements",
      description:
        "Select elements matching a typed filter, replacing or extending the current selection.",
      mutation: true,
      tool: tool(
        async (input) =>
          withEnvelope(true, await session.runHelper("selectElements", input)),
        {
          name: "select_elements",
          description:
            "Mutating tool for selecting elements that match a typed filter.",
          schema: SelectElementsInputSchema,
        },
      ),
    },
    {
      name: "clear_selection",
      description: "Clear the current oxView selection.",
      mutation: true,
      tool: tool(
        async () =>
          withEnvelope(true, await session.runHelper("clearSelection", {})),
        {
          name: "clear_selection",
          description: "Mutating tool for clearing the current selection.",
          schema: EmptyInputSchema,
        },
      ),
    },
    {
      name: "color_elements",
      description:
        "Color elements matching a typed filter using custom, base, or backbone coloring.",
      mutation: true,
      tool: tool(
        async (input) =>
          withEnvelope(true, await session.runHelper("colorElements", input)),
        {
          name: "color_elements",
          description:
            "Mutating tool for recoloring filtered elements. Supports parity, ids, strand ids, base type, selection membership, and attribute predicates.",
          schema: ColorElementsInputSchema,
        },
      ),
    },
    {
      name: "focus_element",
      description:
        "Move the camera toward a specific element id.",
      mutation: true,
      tool: tool(
        async (input) =>
          withEnvelope(true, await session.runHelper("focusElement", input)),
        {
          name: "focus_element",
          description: "Mutating tool for moving the camera toward an element.",
          schema: FocusElementInputSchema,
        },
      ),
    },
    {
      name: "toggle_visibility",
      description:
        "Toggle visibility for elements matching a typed filter.",
      mutation: true,
      tool: tool(
        async (input) =>
          withEnvelope(true, await session.runHelper("toggleVisibility", input)),
        {
          name: "toggle_visibility",
          description: "Mutating tool for toggling visibility of filtered elements.",
          schema: ToggleVisibilityInputSchema,
        },
      ),
    },
    {
      name: "show_everything",
      description:
        "Restore the default scene scaling so all oxView geometry becomes visible again.",
      mutation: true,
      tool: tool(
        async () =>
          withEnvelope(true, await session.runHelper("showEverything", {})),
        {
          name: "show_everything",
          description: "Mutating tool for restoring the default scene scaling.",
          schema: EmptyInputSchema,
        },
      ),
    },
    {
      name: "toggle_base_colors",
      description:
        "Toggle default base colors between type-based colors and grey.",
      mutation: true,
      tool: tool(
        async () =>
          withEnvelope(true, await session.runHelper("toggleBaseColors", {})),
        {
          name: "toggle_base_colors",
          description: "Mutating tool for toggling base colors.",
          schema: EmptyInputSchema,
        },
      ),
    },
    {
      name: "undo",
      description: "Undo the most recent oxView edit or scene action.",
      mutation: true,
      tool: tool(
        async () => withEnvelope(true, await session.runHelper("undo", {})),
        {
          name: "undo",
          description: "Mutating tool for undoing the most recent change.",
          schema: EmptyInputSchema,
        },
      ),
    },
    {
      name: "redo",
      description: "Redo the most recently undone oxView edit or scene action.",
      mutation: true,
      tool: tool(
        async () => withEnvelope(true, await session.runHelper("redo", {})),
        {
          name: "redo",
          description: "Mutating tool for redoing the most recently undone change.",
          schema: EmptyInputSchema,
        },
      ),
    },
  ];

  const toolMap = new Map(definitions.map((definition) => [definition.name, definition]));

  return {
    definitions,
    tools: definitions.map((definition) => definition.tool),
    toolMap,
    availableTools: definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
    })),
  };
}
