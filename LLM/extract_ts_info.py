import os
import re
import json

def extract_ts_info(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')
    
    extracted_data = {
        "imports": [],
        "classes": [],
        "functions": []
    }
    
    # 1. Extract Imports
    import_matches = re.findall(r'import\s+.*?from\s+[\'"](.*?)[\'"]', content)
    extracted_data["imports"] = import_matches

    # 2. Scan for Classes and Functions
    i = 0
    current_class = None
    
    while i < len(lines):
        line = lines[i].strip()
        
        # JSDoc collection
        jsdoc = []
        if line.startswith('/**'):
            # Collect JSDoc
            temp_i = i
            while temp_i < len(lines):
                jsdoc.append(lines[temp_i].strip())
                if '*/' in lines[temp_i]:
                    break
                temp_i += 1
            # If valid JSDoc, update i, otherwise ignore (could be inside comment block?)
             # Actually, simpler: just scan ahead for the next line of code
            if temp_i < len(lines):
                 i = temp_i + 1
                 if i >= len(lines): break
                 line = lines[i].strip()
            else:
                # Malformed/EOF
                break

        # Check for Class Start
        class_match = re.search(r'(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)', line)
        if class_match and '{' in line:
            class_name = class_match.group(1)
            
            # Extract Class Body
            # finding the body is tricky with nested braces, reusing logic or simplifying.
            # To handle class methods correctly, we need to know we are INSIDE a class.
            # So instead of extracting the whole body string, we just enter "Class Mode".
            # But "Class Mode" needs to know when it ends.
            
            # Let's count braces to find the end of the class
            class_start_idx = i
            brace_count = 0
            found_start = False
            
            # We will perform a sub-scan to find the limits of the class
            # This allows us to define the "scope" for the methods we find later
            
            # Actually, simpler approach:
            # We can treat the class just like a function for extraction purposes to get its "Code"
            # And then recursively parse the body? Or just iterate line by line and track depth?
            # Depth tracking is better for single pass.
            pass

        # Let's use a single pass state machine approach for robustness
        # States: GLOBAL, IN_CLASS
        
        # Reset loop for state machine
        break

    # Re-implementing with State Machine
    
    scope_stack = [] # 'global', or class_name
    brace_stack = 0
    
    # We need to map which brace level corresponds to which scope
    # scope_levels = { 0: 'global' } 
    # if class starts at level 0, then level 1 is inside class.
    
    scope_map = {0: 'global'} # level -> scope_name
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        # Count braces in this line to update level at the END of processing (or during?)
        # Start brace increases level. End brace decreases.
        # We need to process line content to identify definitions BEFORE updating full brace count?
        # A line `class Foo {` starts at level 0, ends at level 1.
        # A line `}` starts at level 1, ends at level 0.
        
        # Capture JSDoc (lookbehind or accumulation)
        # We'll just look backwards if we find a definition, or accumulate blank/comment lines
        
        # Heuristic: Accumulate comments coming before a definition
        current_jsdoc = []
        if line.startswith('/**'):
            # consume JSDoc
            while i < len(lines):
                l = lines[i].strip()
                current_jsdoc.append(l)
                if '*/' in l:
                    break
                i += 1
            # Advance to next line which should be the definition
            i += 1
            if i >= len(lines): break
            line = lines[i].strip()
        
        # Check definitions
        
        # Class Definition
        class_match = re.search(r'(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)', line)
        if class_match and '{' in line:
            class_name = class_match.group(1)
            parent_scope = scope_map.get(brace_stack, 'global')
            
            # Record Class
            extracted_data["classes"].append({
                "name": class_name,
                "doc": "\n".join(current_jsdoc),
                "file": file_path,
                "start_line": i
            })
            
            # Update Scope
            # The brace '{' is in this line.
            # We assume classes are at top level or nested in namespaces/functions.
            # We map the NEXT level (brace_stack + 1) to this class
             # But we need to count braces in this line first to be sure
            pass 

        # Function/Method Definition
        # We reuse the specific regexes
        func_match = re.search(r'(?:(?:export|public|private|protected|static|async)\s+)*(?:function\s+)?([a-zA-Z0-9_]+)\s*\((.*?)\)', line)
        # Arrow function (const foo = ... =>)
        arrow_match = re.search(r'(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?(?:\((.*?)\)|([a-zA-Z0-9_]+))\s*=>', line)
        
        defined_name = None
        params = None
        is_function = False
        
        if func_match and '{' in line:
            defined_name = func_match.group(1)
            params = func_match.group(2)
            is_function = True
        elif arrow_match and '{' in line: # Only block arrow functions
            defined_name = arrow_match.group(1)
            params = arrow_match.group(2) or arrow_match.group(3)
            is_function = True

        if is_function and defined_name not in ['if', 'for', 'while', 'switch', 'catch', 'constructor']:
            # Determine Context
            current_scope = scope_map.get(brace_stack, 'global')
            
            # Extract Body
            # We need to scan ahead to capture the full body text
            # Similar logic to previous script
            body_lines = []
            param_brace_count = 0
            found_start = False
            
            j = i
            while j < len(lines):
                l = lines[j]
                
                # Check for start brace on first line
                if j == i:
                     if '{' in l:
                        found_start = True
                        current_line_brace_delta = l.count('{') - l.count('}')
                     else:
                        # Should not happen based on regex match condition '{' in line
                        pass
                else:
                    current_line_brace_delta = l.count('{') - l.count('}')
                
                body_lines.append(l)
                param_brace_count += current_line_brace_delta
                
                if found_start and param_brace_count == 0:
                    break
                j += 1
            
            full_code = "\n".join(body_lines)
            
            extracted_data["functions"].append({
                "name": defined_name,
                "params": params,
                "code": full_code,
                "doc": "\n".join(current_jsdoc),
                "context": current_scope, # Class Name or 'global'
                "file": file_path
            })
            
            # If the function body consumes lines, we should skip them in the main loop?
            # NO, because inner classes/functions might exist? 
            # But for this simple parser, let's assume no important nested defs we care about for now,
            # OR we continue line by line.
            # Proceeding line by line allows brace counting to work correctly for the scope map.
            
        
        # Update Brace Count and Scope Map
        open_braces = line.count('{')
        close_braces = line.count('}')
        
        # Logic: 
        # If we open a new brace, checking if valid scope starter was found
        # (This is getting complex to exact match lines to scopes without a real parser)
        
        # Simplified Scope Tracking:
        # If we found a class definition on this line, set header for next level
        if class_match and '{' in line:
            class_name = class_match.group(1)
            # The level AFTER this line (assuming { is here)
            # brace_stack is current level.
            # line adds X to brace_stack.
            # The scope applies to the NEW level.
            # But line could be `class Foo { bar() { } }` (one line)
            
            # Let's trust the `class_pattern` only matches actual class starts
            new_level = brace_stack + 1 # Assuming 1 open brace contributed by class
            scope_map[new_level] = class_name
            
        
        brace_stack += (open_braces - close_braces)
        
        # If we drop a level, clean up scope map? Not strictly necessary if we overwrite
        if brace_stack < 0: brace_stack = 0 # Safety
        
        i += 1

    return extracted_data

def process_directory(root_dir, output_file):
    all_entries = []
    existing_keys = set()
    
    # Load existing to deduplicate
    if os.path.exists(output_file):
         with open(output_file, 'r') as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    existing_keys.add((entry.get('instruction', ''), entry.get('input', '')))
                except: pass

    for root, dirs, files in os.walk(root_dir):
        for file in files:
            if file.endswith('.ts') and not file.endswith('.d.ts'):
                full_path = os.path.join(root, file)
                print(f"Processing {full_path}...")
                data = extract_ts_info(full_path)
                
                filename = os.path.basename(full_path)
                
                # 1. Integration/Dependency Entries
                if data["imports"]:
                    imports_str = "\n".join(data["imports"])
                    instr = f"What are the dependencies of `{filename}`?"
                    inp = ""
                    out = f"`{filename}` imports the following modules:\n\n```typescript\n{imports_str}\n```"
                    if (instr, inp) not in existing_keys:
                        all_entries.append({"instruction": instr, "input": inp, "output": out})
                        existing_keys.add((instr, inp))
                
                # 2. Class Entries
                for cls in data["classes"]:
                    instr = f"Explain the class `{cls['name']}` from `{filename}`."
                    inp = "" # Could put methods list here?
                    out = f"Class `{cls['name']}` is defined in `{filename}`."
                    if cls['doc']:
                        out += f"\n\nDescription:\n{cls['doc']}"
                    
                    # Verify methods belonging to this class
                    methods = [f for f in data["functions"] if f["context"] == cls["name"]]
                    if methods:
                        out += "\n\nIt contains the following methods:\n"
                        for m in methods:
                            out += f"- `{m['name']}({m['params']})`\n"
                    
                    if (instr, inp) not in existing_keys:
                        all_entries.append({"instruction": instr, "input": inp, "output": out})
                        existing_keys.add((instr, inp))

                # 3. Function/Method Entries
                for f in data["functions"]:
                    # Contextualize instruction
                    if f["context"] != 'global':
                        instr = f"Explain the method `{f['name']}` of class `{f['context']}` from `{filename}`."
                    else:
                        instr = f"Explain the function `{f['name']}` from `{filename}`."
                    
                    inp = f["code"]
                    out = f["doc"] if f["doc"] else f"Function `{f['name']}` takes parameters `({f['params']})`."
                    if f["context"] != 'global':
                         out = f"Method `{f['name']}` of class `{f['context']}`.\n\n" + out
                    
                    out += f"\n\nCode:\n```typescript\n{f['code']}\n```"
                    
                    if (instr, inp) not in existing_keys:
                        all_entries.append({"instruction": instr, "input": inp, "output": out})
                        existing_keys.add((instr, inp))

    print(f"Found {len(all_entries)} new entries.")
    
    with open(output_file, 'a') as f:
        for entry in all_entries:
            f.write(json.dumps(entry) + "\n")

if __name__ == "__main__":
    process_directory("ts", "LLM/alpaca_dataset.jsonl")
