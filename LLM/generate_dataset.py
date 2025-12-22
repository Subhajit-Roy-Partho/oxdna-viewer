
import json
import random

# colormaps extracted from Lut.js
COLORMAPS = [
    "rainbow", "cooltowarm", "blackbody", "grayscale", "viridis", "plasma",
    "inferno", "magma", "cividis", "Greys", "Purples", "Blues", "Greens",
    "Oranges", "Reds", "YlOrBr", "YlOrRd", "OrRd", "PuRd", "RdPu", "BuPu",
    "GnBu", "PuBu", "YlGnBu", "PuBuGn", "BuGn", "YlGn", "binary", "gist_yarg",
    "gist_gray", "gray", "bone", "pink", "spring", "summer", "autumn",
    "winter", "cool", "Wistia", "hot", "afmhot", "gist_heat", "copper",
    "PiYG", "PRGn", "BrBG", "PuOr", "RdGy", "RdBu", "RdYlBu", "RdYlGn",
    "Spectral", "coolwarm", "bwr", "seismic", "hsv", "flag", "prism",
    "ocean", "gist_earth", "terrain", "gist_stern", "gnuplot", "gnuplot2",
    "CMRmap", "cubehelix", "brg", "gist_rainbow", "rainbow_mpl", "jet",
    "nipy_spectral", "gist_ncar"
]

BASES = ['A', 'T', 'G', 'C', 'U']

TEMPLATES = [
    {
        "intent": "split_strand",
        "instruction": "Split the strand at element {id}.",
        "code_template": "api.selectElementIDs([{id}]); edit.splitStrand(api.getElements([{id}])[0]);",
        "params": ["id"]
    },
    {
        "intent": "select_element",
        "instruction": "Select element with ID {id}.",
        "code_template": "api.selectElementIDs([{id}]);",
        "params": ["id"]
    },
    {
        "intent": "highlight_5_prime",
        "instruction": "Highlight the 5' ends of all strands in the system.",
        "code_template": "api.highlight5ps(systems[0]);",
        "params": []
    },
     {
        "intent": "highlight_3_prime",
        "instruction": "Highlight the 3' ends of all strands in the system.",
        "code_template": "api.highlight3ps(systems[0]);",
        "params": []
    },
    {
        "intent": "toggle_strand_visibility",
        "instruction": "Toggle the visibility of the strand containing element {id}.",
        "code_template": "api.toggleStrand(api.getElements([{id}])[0].strand);",
        "params": ["id"]
    },
    {
        "intent": "delete_element",
        "instruction": "Delete the element with ID {id}.",
        "code_template": "edit.deleteElements(api.getElements([{id}]));",
        "params": ["id"]
    },
    {
        "intent": "change_colormap",
        "instruction": "Change the colormap to {colormap}.",
        "code_template": "api.changeColormap('{colormap}');",
        "params": ["colormap"]
    },
    {
        "intent": "extend_strand",
        "instruction": "Extend the strand at element {id} with sequence '{sequence}'.",
        "code_template": "edit.extendStrand(api.getElements([{id}])[0], '{sequence}');",
        "params": ["id", "sequence"]
    },
     {
        "intent": "nick_element",
        "instruction": "Nick the strand at element {id}.",
        "code_template": "edit.nick(api.getElements([{id}])[0]);",
        "params": ["id"]
    },
    {
         "intent": "move_to",
         "instruction": "Move specific elements to the position of element {id}.",
         "code_template": "edit.move_to(api.getElements([{id}])[0], api.getElements({ids}));",
         "params": ["id", "ids"]
    },
    {
         "intent": "count_strands",
         "instruction": "Count the number of strands of each length in the system.",
         "code_template": "api.countStrandLength(systems[0]);",
         "params": []
    },
     {
        "intent": "toggle_everything",
        "instruction": "Toggle visibility of all elements.",
        "code_template": "api.toggleAll(systems[0]);",
        "params": []
    },
    {
        "intent": "trace_53",
        "instruction": "Trace the strand from 5' to 3' starting at element {id}.",
        "code_template": "api.trace53(api.getElements([{id}])[0]);",
        "params": ["id"]
    },
     {
        "intent": "trace_35",
        "instruction": "Trace the strand from 3' to 5' starting at element {id}.",
        "code_template": "api.trace35(api.getElements([{id}])[0]);",
        "params": ["id"]
    },
    {
        "intent": "switch_camera",
        "instruction": "Switch the camera mode between Perspective and Orthographic.",
        "code_template": "api.switchCamera();",
        "params": []
    },
    {
        "intent": "insert_sequence",
        "instruction": "Insert sequence '{sequence}' at element {id}.",
        "code_template": "edit.insert(api.getElements([{id}])[0], '{sequence}');",
        "params": ["id", "sequence"]
    },
    {
        "intent": "skip_elements",
        "instruction": "Skip (delete and ligate) elements {ids}.",
        "code_template": "edit.skip(api.getElements({ids}));",
        "params": ["ids"]
    },
    {
        "intent": "ligate_elements",
        "instruction": "Ligate element {id1} and {id2}.",
        "code_template": "edit.ligate(api.getElements([{id1}])[0], api.getElements([{id2}])[0]);",
        "params": ["id1", "id2"]
    },
    {
        "intent": "extend_duplex",
        "instruction": "Extend duplex at element {id} with sequence '{sequence}'.",
        "code_template": "edit.extendDuplex(api.getElements([{id}])[0], '{sequence}');",
        "params": ["id", "sequence"]
    },
    {
        "intent": "set_sequence",
        "instruction": "Set the sequence of elements {ids} to '{sequence_matching_ids}'.",
        "code_template": "edit.setSequence(new Set(api.getElements({ids})), '{sequence_matching_ids}');",
        "params": ["ids", "sequence_matching_ids"]
    },
    {
        "intent": "toggle_base_colors",
        "instruction": "Toggle nucleotide base colors.",
        "code_template": "api.toggleBaseColors();",
        "params": []
    },
    {
        "intent": "update_3prime_markers",
        "instruction": "Update 3' markers with diameter {d}, length {l}, and spacing {s}.",
        "code_template": "api.update3primeMarkers({d}, {l}, {s});",
        "params": ["d", "l", "s"]
    },
    {
        "intent": "show_everything",
        "instruction": "Show everything in the scene.",
        "code_template": "api.showEverything();",
        "params": []
    },
    {
        "intent": "find_element",
        "instruction": "Find and center view on element {id}.",
        "code_template": "api.findElement(api.getElements([{id}])[0]);",
        "params": ["id"]
    },
    {
        "intent": "remove_colorbar",
        "instruction": "Remove the colorbar from the scene.",
        "code_template": "api.removeColorbar();",
        "params": []
    },
    {
        "intent": "show_colorbar",
        "instruction": "Show the colorbar in the scene.",
        "code_template": "api.showColorbar();",
        "params": []
    }
]

def generate_random_id(max_id=20):
    return random.randint(0, max_id)

def generate_random_ids(n=3, max_id=20):
    return [random.randint(0, max_id) for _ in range(n)] # json.dumps will handle the list

def generate_random_sequence(length_range=(3, 10)):
    length = random.randint(*length_range)
    return "".join(random.choices(BASES, k=length))

def generate_dataset(num_entries=5000, filename="LLM/alpaca_dataset.jsonl"):
    data = []
    
    for _ in range(num_entries):
        template = random.choice(TEMPLATES)
        
        params = {}
        if "id" in template["params"]:
            params["id"] = generate_random_id()
        if "id1" in template["params"]:
            params["id1"] = generate_random_id()
        if "id2" in template["params"]:
            params["id2"] = generate_random_id()
        if "ids" in template["params"]:
            _ids = generate_random_ids()
            params["ids"] = str(_ids)
            
            if "sequence_matching_ids" in template["params"]:
                 params["sequence_matching_ids"] = "".join(random.choices(BASES, k=len(_ids)))
                 
        if "sequence" in template["params"]:
            params["sequence"] = generate_random_sequence()
            
        if "colormap" in template["params"]:
            params["colormap"] = random.choice(COLORMAPS)
            
        if "d" in template["params"]:
            params["d"] = round(random.uniform(0.1, 2.0), 2)
            params["l"] = round(random.uniform(0.5, 5.0), 2)
            params["s"] = round(random.uniform(0.1, 2.0), 2)
            
        instruction = template["instruction"].format(**params)
        code = template["code_template"].format(**params)
        
        entry = {
            "instruction": instruction,
            "input": "",
            "output": code
        }
        data.append(entry)
        
    with open(filename, 'w') as f:
        for entry in data:
            f.write(json.dumps(entry) + "\n")
            
    print(f"Generated {num_entries} entries in {filename}")

if __name__ == "__main__":
    generate_dataset()
