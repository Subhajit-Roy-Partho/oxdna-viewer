
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
        "intent": "extend_all_3_prime",
        "instruction": "Add '{sequence}' to the end of all strands (at the 3' end).",
        "code_template": "systems[0].strands.forEach(s => edit.extendStrand(s.end3, '{sequence}'));",
        "params": ["sequence"]
    },
    {
        "intent": "get_all_3_prime_ids",
        "instruction": "Return the IDs of all 3' end nucleotides.",
        "code_template": "systems[0].strands.map(s => s.end3.id);",
        "params": []
    },
    {
        "intent": "ligate_strands_by_id",
        "instruction": "Join strand {id1} and strand {id2} (ligate 3' of {id1} to 5' of {id2}).",
        "code_template": "var s1 = systems[0].strands.find(s => s.id == {id1}); var s2 = systems[0].strands.find(s => s.id == {id2}); if(s1 && s2) edit.ligate(s1.end3, s2.end5);",
        "params": ["id1", "id2"]
    },
    {
        "intent": "create_duplex",
        "instruction": "Generate a {length} nucleotide duplex with sequence '{sequence}'.",
        "code_template": "edit.createStrand('{sequence}', true);",
        "params": ["length", "sequence"]
    },
    {
        "intent": "create_single_strand",
        "instruction": "Generate a {length} nucleotide single strand with sequence '{sequence}'.",
        "code_template": "edit.createStrand('{sequence}', false);",
        "params": ["length", "sequence"]
    },
    {
        "intent": "color_nucleotides_pattern",
        "instruction": "Color every even nucleotide red (0xff0000) and odd nucleotide green (0x00ff00).",
        "code_template": "var red = 0xff0000; var green = 0x00ff00; var sys = systems[0]; sys.getMonomers().forEach(e => {{ var color = (e.id % 2 === 0) ? red : green; var c = new THREE.Color(color); sys.fillVec('nsColors', 3, e.sid, [c.r, c.g, c.b]); }}); sys.callUpdates(['instanceColor']); render();",
        "params": []
    },
    {
        "intent": "color_5_prime_ends_custom",
        "instruction": "Color the 5' end of every strand blue (0x0000ff).",
        "code_template": "var color = new THREE.Color(0x0000ff); systems[0].strands.forEach(s => {{ var e = s.end5; s.system.fillVec('nsColors', 3, e.sid, [color.r, color.g, color.b]); }}); systems[0].callUpdates(['instanceColor']); render();",
        "params": []
    },
    {
        "intent": "set_color_bounds",
        "instruction": "Set the color map bounds from {min_val} to {max_val}",
        "code_template": "api.setColorBounds({min_val}, {max_val})",
        "params": ["min_val", "max_val"]
    },
    {
        "intent": "toggle_elements",
        "instruction": "Toggle visibility of elements with IDs {ids}",
        "code_template": "api.toggleElements(api.getElements({ids}))",
        "params": ["ids"]
    },
    {
        "intent": "create_rna_strand",
        "instruction": "Create an RNA strand with sequence {sequence}",
        "code_template": "edit.createStrand('{sequence}', false, true)",
        "params": ["sequence"]
    },
    {
        "intent": "create_rna_duplex",
        "instruction": "Create an RNA duplex with sequence {sequence}",
        "code_template": "edit.createStrand('{sequence}', true, true)",
        "params": ["sequence"]
    },
    {
        "intent": "connect_duplex_3p",
        "instruction": "Connect 3' ends of strand {id1} and strand {id2} with a duplex",
        "code_template": "edit.interconnectDuplex3p(api.getElements([{id1}])[0].strand, api.getElements([{id2}])[0].strand)",
        "params": ["id1", "id2"]
    },
    {
        "intent": "connect_duplex_5p",
        "instruction": "Connect 5' ends of strand {id1} and strand {id2} with a duplex",
        "code_template": "edit.interconnectDuplex5p(api.getElements([{id1}])[0].strand, api.getElements([{id2}])[0].strand)",
        "params": ["id1", "id2"]
    },
    {
        "intent": "show_cms",
        "instruction": "Show center of mass for elements {ids}",
        "code_template": "new api.observable.CMS(api.getElements({ids}), 1, 0xFF0000)",
        "params": ["ids"]
    },
    {
        "intent": "show_mean_orientation",
        "instruction": "Show mean orientation for elements {ids}",
        "code_template": "new api.observable.MeanOrientation(api.getElements({ids}))",
        "params": ["ids"]
    },
    {
        "intent": "change_background_color",
        "instruction": "Set the background color to {color_hex}",
        "code_template": "scene.background = new THREE.Color({color_hex}); render();",
        "params": ["color_hex"]
    },
    {
        "intent": "add_ambient_light",
        "instruction": "Add an ambient light with color {color_hex} and intensity {intensity}",
        "code_template": "var l = new THREE.AmbientLight({color_hex}, {intensity}); scene.add(l); render();",
        "params": ["color_hex", "intensity"]
    },
    {
        "intent": "add_point_light",
        "instruction": "Add a point light at {x}, {y}, {z} with color {color_hex} and intensity {intensity}",
        "code_template": "var l = new THREE.PointLight({color_hex}, {intensity}); l.position.set({x}, {y}, {z}); scene.add(l); render();",
        "params": ["x", "y", "z", "color_hex", "intensity"]
    },
    {
        "intent": "add_cube",
        "instruction": "Add a cube of size {d} at {x}, {y}, {z} with color {color_hex}",
        "code_template": "var g = new THREE.BoxGeometry({d}, {d}, {d}); var m = new THREE.MeshLambertMaterial({{color: {color_hex}}}); var mesh = new THREE.Mesh(g, m); mesh.position.set({x}, {y}, {z}); scene.add(mesh); render();",
        "params": ["d", "x", "y", "z", "color_hex"]
    },
    {
        "intent": "rotate_camera",
        "instruction": "Rotate the camera by {x} degrees around the X axis and {y} degrees around the Y axis",
        "code_template": "camera.rotateX({x} * Math.PI / 180); camera.rotateY({y} * Math.PI / 180); camera.updateProjectionMatrix(); render();",
        "params": ["x", "y"]
    },
    {
        "intent": "zoom_camera",
        "instruction": "Zoom the camera to {zoom}x",
        "code_template": "camera.zoom = {zoom}; camera.updateProjectionMatrix(); render();",
        "params": ["zoom"]
    }
]

def generate_random_id(max_id=2000):
    return random.randint(0, max_id)

def generate_random_ids(n=3, max_id=2000):
    return [random.randint(0, max_id) for _ in range(n)]

def generate_random_sequence(length_range=(3, 20)):
    length = random.randint(*length_range)
    return "".join(random.choices(BASES, k=length)), length

def generate_dataset(num_entries=10000, filename="LLM/alpaca_dataset.jsonl"):
    data = []
    seen = set()
    attempts = 0
    max_attempts = num_entries * 5
    
    while len(data) < num_entries and attempts < max_attempts:
        attempts += 1
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
            length_param = "length" in template["params"]
            if length_param:
                seq, length = generate_random_sequence((5, 30))
                params["sequence"] = seq
                params["length"] = length
            else:
                params["sequence"], _ = generate_random_sequence()
        elif "length" in template["params"]:
             pass

        if "colormap" in template["params"]:
            params["colormap"] = random.choice(COLORMAPS)
            
        if "d" in template["params"]:
            params["d"] = round(random.uniform(0.1, 5.0), 2)
            params["l"] = round(random.uniform(0.5, 10.0), 2)
            params["s"] = round(random.uniform(0.1, 5.0), 2)
        
        if "min_val" in template["params"]:
            params["min_val"] = round(random.uniform(0.0, 5.0), 2)
            params["max_val"] = round(random.uniform(5.5, 10.0), 2)
            
        if "color_hex" in template["params"]:
            params["color_hex"] = "0x" + "".join(random.choices("0123456789ABCDEF", k=6))
            
        if "intensity" in template["params"]:
            params["intensity"] = round(random.uniform(0.5, 2.0), 1)
            
        if "x" in template["params"]:
             params["x"] = round(random.uniform(-100, 100), 1)
             params["y"] = round(random.uniform(-100, 100), 1)
             params["z"] = round(random.uniform(-100, 100), 1)
             
        if "zoom" in template["params"]:
             params["zoom"] = round(random.uniform(0.5, 3.0), 1)

        instruction = template["instruction"].format(**params)
        code = template["code_template"].format(**params)
        
        entry = {
            "instruction": instruction,
            "input": "",
            "output": code
        }
        
        # Serialize for deduplication
        entry_str = json.dumps(entry, sort_keys=True)
        
        if entry_str not in seen:
            seen.add(entry_str)
            data.append(entry)
        
    with open(filename, 'w') as f:
        for entry in data:
            f.write(json.dumps(entry) + "\n")
            
    print(f"Generated {len(data)} unique entries in {filename} (Attempts: {attempts})")

if __name__ == "__main__":
    generate_dataset()
