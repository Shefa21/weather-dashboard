const { sendToLlama } = require("./llamaClient");

let customPrompt = "";

function setCustomPrompt(prompt) {
  customPrompt = prompt;
}

async function analyzeDashboardScreenshot({ llamaEndpoint, screenshotPath, meta }) {
  const response = await sendToLlama({
    endpoint: llamaEndpoint,
    imagePath: screenshotPath,
    prompt: customPrompt,
    meta,
  });

  return { raw: response };
}

module.exports = {
  analyzeDashboardScreenshot,
  setCustomPrompt,
};