
import json

def select_verification_commands(input_file="LLM/alpaca_dataset.jsonl", output_file="LLM/verification_commands.json"):
    commands = []
    seen_intents = set()
    
    # Map instruction keywords to intents
    intent_map = {
        "Split the strand": "split_strand",
        "Select element": "select_element",
        "Highlight the 5' ends": "highlight_5_prime",
        "Highlight the 3' ends": "highlight_3_prime",
        "Toggle the visibility": "toggle_strand_visibility",
        "Delete the element": "delete_element",
        "Change the colormap": "change_colormap",
        "Extend the strand": "extend_strand",
        "Nick the strand": "nick_element",
        "Move specific elements": "move_to",
        "Count the number": "count_strands",
        "Toggle visibility of all": "toggle_everything",
        "Trace the strand from 5'": "trace_53",
        "Trace the strand from 3'": "trace_35",
        "Switch the camera": "switch_camera",
        "Insert sequence": "insert_sequence",
        "Skip (delete and ligate)": "skip_elements",
        "Ligate element": "ligate_elements",
        "Extend duplex": "extend_duplex",
        "Set the sequence": "set_sequence",
        "Toggle nucleotide base colors": "toggle_base_colors",
        "Update 3' markers": "update_3prime_markers",
        "Show everything": "show_everything",
        "Find and center view": "find_element",
        "Remove the colorbar": "remove_colorbar",
        "Show the colorbar": "show_colorbar",
        "Add '{sequence}' to the end": "extend_all_3_prime",
        "Return the IDs of all 3'": "get_all_3_prime_ids",
        "Join strand": "ligate_strands_by_id",
        "Generate a": "create_duplex", # Matches both "Generate a {length} nucleotide duplex" and "single strand" if careful, but order matters
        "nucleotide duplex": "create_duplex",
        "nucleotide single strand": "create_single_strand",
        "Color every even": "color_nucleotides_pattern",
        "Color the 5' end of every": "color_5_prime_ends_custom",
        "Set the color map bounds": "set_color_bounds",
        "Toggle visibility of elements": "toggle_elements",
        "Create an RNA strand": "create_rna_strand",
        "Create an RNA duplex": "create_rna_duplex",
        "Connect 3' ends": "connect_duplex_3p",
        "Connect 5' ends": "connect_duplex_5p",
        "Show center of mass": "show_cms",
        "Show mean orientation": "show_mean_orientation",
        "Set the background color": "change_background_color",
        "Add an ambient light": "add_ambient_light",
        "Add a point light": "add_point_light",
        "Add a cube": "add_cube",
        "Rotate the camera": "rotate_camera",
        "Zoom the camera": "zoom_camera",
        "Color strands longer than": "color_strands_by_length",
        "Hide strands shorter than": "hide_short_strands",
        "Select the first and last": "select_first_last_strand",
        "Translate system": "translate_system" 
    }

    with open(input_file, 'r') as f:
        for line in f:
            entry = json.loads(line)
            instruction = entry['instruction']
            intent = "unknown"
            
            for key, val in intent_map.items():
                if key in instruction:
                    intent = val
                    break
            
            if intent != "unknown" and intent not in seen_intents:
                commands.append(entry)
                seen_intents.add(intent)
                
    with open(output_file, 'w') as f:
        json.dump(commands, f, indent=2)
        
    print(f"Selected {len(commands)} unique commands for verification.")
    print("Intents found:", seen_intents)

if __name__ == "__main__":
    select_verification_commands()
