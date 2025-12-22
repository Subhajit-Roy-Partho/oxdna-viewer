
import json

def filter_dataset(input_file="LLM/alpaca_dataset.jsonl", clean_file="LLM/alpaca_dataset.jsonl", bad_file="LLM/notWorking.json"):
    # Based on browser verification:
    # split_strand: edit.splitStrand is not exported (private).
    # remove_colorbar: lut.legend undefined.
    # show_colorbar: lut.legend undefined.
    
    BAD_INTENTS = {
        "split_strand",
        "remove_colorbar",
        "show_colorbar",
        "extend_all_3_prime",
        "ligate_strands_by_id",
        "set_color_bounds",
        "split_strand" # Duplicate but harmless
    }

    # Helper to map instruction to intent (reuse logic or just simple string match for now)
    # Since I don't have the intent explicitly in the jsonl (only instruction/output), I must infer it or match the code.
    # Matching code is safer.
    
    # "code_template": "edit.splitStrand..."
    # "code_template": "api.removeColorbar..."
    # "code_template": "api.showColorbar..."
    
    clean_entries = []
    bad_entries = []
    
    with open(input_file, 'r') as f:
        for line in f:
            entry = json.loads(line)
            code = entry['output']
            
            is_bad = False
            if "edit.splitStrand" in code:
                is_bad = True
            elif "api.removeColorbar" in code:
                is_bad = True
            elif "api.showColorbar" in code:
                is_bad = True
            elif "edit.extendStrand" in code and "systems[0].strands.forEach" in code: # Heuristic for extend_all_3_prime logic
                 is_bad = True
            elif "edit.ligate" in code and "systems[0].strands.find" in code: # Heuristic for ligate_strands_by_id logic
                 is_bad = True
            elif "api.setColorBounds" in code:
                 is_bad = True
                
            if is_bad:
                bad_entries.append(entry)
            else:
                clean_entries.append(entry)
                
    with open(clean_file, 'w') as f:
        for entry in clean_entries:
            f.write(json.dumps(entry) + "\n")
            
    with open(bad_file, 'w') as f:
        for entry in bad_entries:
            f.write(json.dumps(entry) + "\n")
            
    print(f"Filtered dataset.")
    print(f"Kept {len(clean_entries)} good entries.")
    print(f"Removed {len(bad_entries)} bad entries.")

if __name__ == "__main__":
    filter_dataset()
