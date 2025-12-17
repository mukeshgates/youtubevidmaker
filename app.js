
const API_BASE = "https://<your-vercel-project>.vercel.app/api"; // set this

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $("status").textContent = t; };

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const minutes = parseInt($("duration").value, 10);
  const wpm = parseInt($("wpm").value, 10);
  const style = $("style").value.trim();
  const draft = $("draft").value.trim();
  if (!draft) return setStatus("Please paste your idea.");

  $("cards").innerHTML = "";
  $("preview").classList.add("hidden");
  $("download").classList.add("hidden");
  setStatus("Expanding and rewriting your script…");

  try {
    // 1) Expand & create prompts (20/minute)
    const r1 = await fetch(`${API_BASE}/expand-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, target_minutes: minutes, wpm, style })
    });
    if (!r1.ok) throw new Error(await r1.text());
    const data = await r1.json(); // {script, prompts: [{index, sentence, image_prompt}]}

    const total = data.prompts.length;
    setStatus(`Generating ${total} images with Gemini (this may take a while)…`);

    // 2) Generate images (limit concurrency to avoid rate spikes)
    const images = [];
    const concurrency = 3;
    let i = 0;

    async function worker() {
      while (i < total) {
        const s = data.prompts[i++];
        await new Promise(r => setTimeout(r, 200));
        const resp = await fetch(`${API_BASE}/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: s.image_prompt,
            index: s.index,
            aspect: "1:1",
            imageSize: "1k" // bump to "2k" if needed
          })
        });
        if (!resp.ok) throw new Error(await resp.text());
        const imgPayload = await resp.json(); // { index, mime, b64 }
        images.push(imgPayload);

        // Show preview
        const wrap = document.createElement("div");
        wrap.className = "card";
        const img = new Image();
        img.src = `data:${imgPayload.mime};base64,${imgPayload.b64}`;
        img.alt = s.sentence;
        const p = document.createElement("p");
        p.textContent = `${String(s.index).padStart(3, "0")}. ${s.sentence}`;
        wrap.appendChild(img);
        wrap.appendChild(p);
        $("cards").appendChild(wrap);
        $("preview").classList.remove("hidden");
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    setStatus("Packaging ZIP…");

    // 3) Build ZIP with JSZip (images + script + prompts.md + mapping.csv)
    const zip = new JSZip();
    zip.file("script.txt", data.script);

    const promptsMd = [
      "# Image Prompts",
      `Total: ${total}`,
      "",
      ...data.prompts.map(p => `### ${String(p.index).padStart(3, "0")} — ${p.sentence}\n${p.image_prompt}`)
    ].join("\n");
    zip.file("prompts.md", promptsMd);

    const csvHeader = "index,sentence,image_prompt,filename\n";
    const rows = data.prompts.map(p => {
      const fname = `${String(p.index).padStart(3, "0")}.png`;
      return `${p.index},"${p.sentence.replaceAll('"','""')}","${p.image_prompt.replaceAll('"','""')}",${fname}`;
    });
    zip.file("mapping.csv", csvHeader + rows.join("\n"));

    const imgFolder = zip.folder("images");
    for (const im of images.sort((a,b) => a.index - b.index)) {
      const fname = `${String(im.index).padStart(3, "0")}.png`;
      imgFolder.file(fname, im.b64, { base64: true });
    }

    const blob = await zip.generateAsync({ type: "blob" });
    $("download").classList.remove("hidden");
    $("download").onclick = () => saveAs(blob, "storyboard.zip");

    setStatus("Done!");
  } catch (err) {
    console.error(err);
       setStatus(`Error: ${err.message}`);
  }
