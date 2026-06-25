window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled Promise Rejection:', ev.reason);
  const loaderMsg = document.querySelector('#loader p');
  if (loaderMsg) loaderMsg.textContent = ev.reason?.message || String(ev.reason || 'Unhandled promise rejection');
});
document.addEventListener('DOMContentLoaded', () => {
document.getElementById('researchForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const topic = document.getElementById('topic').value;
    const context = document.getElementById('context').value;

    // UI states
    const loader = document.getElementById('loader');
    const results = document.getElementById('results');
    const submitBtn = document.getElementById('submitBtn');
    const errorPanel = document.getElementById('errorReport');
    const errorContent = document.getElementById('errorReportContent');

    // clear previous error report
    if (errorPanel) errorPanel.classList.add('hidden');
    if (errorContent) errorContent.textContent = '';

    loader.classList.remove('hidden');
    results.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Analyzing...';

    try {
        const analysis = await generateAnalysis(topic, context);
        displayResults(analysis);
    } catch (error) {
      console.error('Error generating analysis:', error);
      const loaderMsg = document.querySelector('#loader p');
      if (loaderMsg) loaderMsg.textContent = error.message || 'Failed to generate analysis.';
      alert('Failed to generate analysis. Please try again. ' + (error.message || ''));
    } finally {
        loader.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-text">Generate Analysis</span><span class="btn-glow"></span>';
    }
});

// Helper: sleep for given milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Core request wrapper with retry, back‑off and fallback logic
// Supported models: Currently using gemini-2.5-flash (verified working)
// Note: Other models (gemini-2.5-flash-exp, gemini-2.0-flash-001) are either 404 or quota-limited
async function fetchWithRetry(prompt, models = ["gemini-2.5-flash"]) {
  const maxAttempts = 3;
  const backoff = [2000, 5000, 10000]; // 2s, 5s, 10s exponential backoff
  const attemptsLog = [];
  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    console.log(`🚀 Trying model ${model}`);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Send request to backend proxy endpoint which holds the secret key server-side.
        const url = '/api/generate';
        const payload = { model, prompt };
        console.log(`Attempt ${attempt + 1} – POST ${url} (model=${model})`);
        console.log('Request payload:', payload);
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        console.log('Response status:', response.status);
        const responseText = await response.text();
        console.log('Response body (text):', responseText);

        // record attempt
        const attemptRecord = {
          model,
          attempt: attempt + 1,
          request: payload,
          responseStatus: response.status,
          responseBody: responseText,
          success: false,
          errorCode: null,
          errorMessage: null
        };

        if (!response.ok) {
          let errObj = null;
          try {
            errObj = JSON.parse(responseText);
          } catch (parseErr) {
            errObj = { error: { message: responseText || `HTTP ${response.status}` } };
          }
          const msg = errObj.error?.message || `HTTP ${response.status}`;
          attemptRecord.errorMessage = msg;
          attemptRecord.errorCode = errObj.error?.code || errObj.error?.status || null;
          attemptsLog.push(attemptRecord);
          
          // Check for quota/rate limit to determine if transient
          const isTransient = response.status === 429 || response.status === 500 || response.status === 503 
            || /high demand|rate limit|quota|unavailable|resource.exhausted/i.test(msg);
          
          if (isTransient) {
            console.warn(`Transient error (${response.status}): ${msg}`);
            throw new Error(msg);
          }
          throw new Error(`Fatal API error (${response.status}): ${msg}`);
        }

        let data = null;
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          // If the proxy returned raw model output or plain text, keep as text
          data = responseText;
        }
        // Support two response shapes:
        // 1) Proxy returns raw model response with `candidates` (then extract text)
        // 2) Proxy already parsed and returned the structured JSON
        let parsed;
        if (data && data.candidates && data.candidates[0] && data.candidates[0].content) {
          const resultText = data.candidates[0].content.parts[0].text;
          try {
            parsed = JSON.parse(resultText);
          } catch (parseErr) {
            attemptRecord.responseBody = resultText;
            attemptRecord.errorMessage = 'Failed to parse model output as JSON';
            attemptsLog.push(attemptRecord);
            throw new Error('Failed to parse model output as JSON');
          }
        } else if (typeof data === 'string') {
          // Proxy may have already returned the structured JSON as a string
          try {
            parsed = JSON.parse(data);
          } catch (parseErr) {
            attemptRecord.responseBody = data;
            attemptRecord.errorMessage = 'Proxy returned text that is not valid JSON';
            attemptsLog.push(attemptRecord);
            throw new Error('Proxy returned text that is not valid JSON');
          }
        } else {
          parsed = data;
        }
        if (!parsed.keyPoints || !parsed.analysis || !parsed.recommendation) {
            attemptRecord.responseBody = JSON.stringify(parsed);
            attemptRecord.errorMessage = 'Invalid JSON structure returned from model';
            attemptsLog.push(attemptRecord);
            throw new Error("Invalid JSON structure returned from model.");
        }
        attemptRecord.success = true;
        attemptsLog.push(attemptRecord);
        // attach attemptsLog to the successful parsed object for diagnostics if needed
        parsed.__attempts = attemptsLog;
        return parsed;
      } catch (e) {
        console.error(`❗ Attempt ${attempt + 1} failed for model ${model}:`, e);
        if (attempt === maxAttempts - 1) {
          console.warn(`⚠️ Exhausted retries for ${model}.`);
          // push final failure summary for this model if not already recorded
          if (!attemptsLog.find(a => a.model === model && a.attempt === attempt + 1)) {
            attemptsLog.push({ model, attempt: attempt + 1, request: { model, prompt }, responseStatus: null, responseBody: null, success: false, errorMessage: e.message });
          }
          break;
        }
        const loaderMsg = document.querySelector('#loader p');
        if (loaderMsg) {
          const waitSec = backoff[attempt] / 1000;
          loaderMsg.textContent = `Retry attempt ${attempt + 2} of ${maxAttempts} (waiting ${waitSec}s)...`;
        }
        console.log(`Waiting ${backoff[attempt]}ms before retry...`);
        await sleep(backoff[attempt]);
      }
    }
    if (modelIdx < models.length - 1) {
      const loaderMsg = document.querySelector('#loader p');
      if (loaderMsg) {
        loaderMsg.textContent = `Using backup model (${models[modelIdx + 1]})...`;
      }
      console.info(`Switching to fallback model ${models[modelIdx + 1]}`);
    }
  }
  // Build a detailed report and throw it so caller can display it.
  const report = {
    message: 'All Gemini models failed',
    attempts: attemptsLog
  };
  console.log("Attempts:", attemptsLog);
  const err = new Error('All Gemini models failed. See attempts for details.');
  err.attempts = attemptsLog;
  // render error report in UI
  try { renderErrorReport(attemptsLog); } catch (uiErr) { console.error('Failed to render error report', uiErr); }
  throw err;
}

// Map HTTP status codes to user-friendly messages
function getUserFriendlyMessage(statusCode, errorMessage) {
  switch (statusCode) {
    case 401:
    case 403:
      return '🔐 Authentication or permission error. Check your API key.';
    case 404:
      return '⚠️  Model configuration error. Model may not be available.';
    case 429:
      return '⏱️  Rate limit or quota exceeded. Please try again later.';
    case 500:
    case 503:
      return '🔄 Google Gemini service is temporarily unavailable. Please try again later.';
    case 400:
      return '❌ Invalid request. Please check your input and try again.';
    default:
      return `Error (${statusCode}): ${errorMessage || 'Unknown error'}`;
  }
}

// Render a human-readable error report in the UI
function renderErrorReport(attempts) {
  const panel = document.getElementById('errorReport');
  const content = document.getElementById('errorReportContent');
  if (!panel || !content) return;
  panel.classList.remove('hidden');
  
  // Analyze errors
  const quotaErrors = attempts.filter(a => a.responseStatus === 429 || /quota|resource.exhausted/i.test(a.errorMessage || ''));
  const unavailableErrors = attempts.filter(a => a.responseStatus === 503);
  const notFoundErrors = attempts.filter(a => a.responseStatus === 404);
  
  // Build report text
  let out = '=== API REQUEST FAILURE REPORT ===\n\n';
  
  // Show summary
  if (quotaErrors.length > 0) {
    out += '💳 QUOTA EXCEEDED\n';
    out += '   Your API key has reached its usage limit.\n';
    out += '   Action: Upgrade to a paid Gemini API plan or create a new project.\n\n';
  }
  if (unavailableErrors.length > 0) {
    out += '🔄 SERVICE TEMPORARILY UNAVAILABLE\n';
    out += '   Google Gemini service experienced high demand or temporary issues.\n';
    out += '   Action: Wait a few moments and try again.\n\n';
  }
  if (notFoundErrors.length > 0) {
    out += '⚠️  MODEL NOT FOUND\n';
    out += '   Attempted model is not available or unsupported.\n';
    out += '   Action: Check model names and supported versions.\n\n';
  }
  
  out += '=== DETAILED ATTEMPT LOGS ===\n\n';
  
  attempts.forEach(at => {
    out += `Model: ${at.model}\n`;
    out += `Attempt #${at.attempt}\n`;
    out += `Endpoint: /api/generate\n`;
    out += `HTTP Status: ${at.responseStatus || 'N/A'}\n`;
    out += `Error Code: ${at.errorCode || 'N/A'}\n`;
    out += `Error Message: ${at.errorMessage || 'N/A'}\n`;
    out += `User Message: ${getUserFriendlyMessage(at.responseStatus, at.errorMessage)}\n`;
    out += `Success: ${at.success ? '✅ YES' : '❌ NO'}\n`;
    out += '---\n';
  });
  content.textContent = out;
}

// Updated generateAnalysis that delegates to fetchWithRetry
async function generateAnalysis(topic, context) {
  const promptText = `
You are an expert Topic Research Assistant.
Topic: ${topic}
Context/Source: ${context || 'None provided'}

Provide a structured analysis with the following sections EXACTLY:
1. "keyPoints": Array of 5 strings (bullet points summarizing the topic).
2. "analysis": { "type": "string", "positive": ["string"], "negative": ["string"] }
3. "recommendation": "string"

Output ONLY valid JSON without any markdown formatting. The JSON should match the structure above.`;
  const loaderMsg = document.querySelector('#loader p');
  if (loaderMsg) loaderMsg.textContent = "Accessing Neural Web...";
  console.log('🔎 Sending prompt to Gemini');
  return await fetchWithRetry(promptText);
}

function displayResults(data) {
    // hide error report on success
    const errorPanel = document.getElementById('errorReport');
    const errorContent = document.getElementById('errorReportContent');

    if (errorPanel) errorPanel.classList.add('hidden');
    if (errorContent) errorContent.textContent = '';

    // Get all required elements
    const keyPointsList = document.getElementById('keyPointsList');
    const analysisTitle = document.getElementById('analysisTitle');
    const positiveTitle = document.getElementById('positiveTitle');
    const negativeTitle = document.getElementById('negativeTitle');
    const positiveList = document.getElementById('positiveList');
    const negativeList = document.getElementById('negativeList');
    const recommendationText = document.getElementById('recommendationText');
    const results = document.getElementById('results');

    // Safety check
    if (
        !keyPointsList ||
        !analysisTitle ||
        !positiveTitle ||
        !negativeTitle ||
        !positiveList ||
        !negativeList ||
        !recommendationText ||
        !results
    ) {
        console.error('Missing HTML element(s):', {
            keyPointsList,
            analysisTitle,
            positiveTitle,
            negativeTitle,
            positiveList,
            negativeList,
            recommendationText,
            results
        });
        return;
    }

    // Key Points
    keyPointsList.innerHTML = '';
    (data.keyPoints || []).forEach(point => {
        const li = document.createElement('li');
        li.textContent = point;
        keyPointsList.appendChild(li);
    });

    // Analysis
    analysisTitle.textContent = data.analysis?.type || 'Analysis';

    const isProsCons =
        (data.analysis?.type || '').toLowerCase().includes('pros');

    positiveTitle.textContent = isProsCons ? 'Pros' : 'Opportunities';
    negativeTitle.textContent = isProsCons ? 'Cons' : 'Risks';

    positiveList.innerHTML = '';
    (data.analysis?.positive || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        positiveList.appendChild(li);
    });

    negativeList.innerHTML = '';
    (data.analysis?.negative || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        negativeList.appendChild(li);
    });

    // Recommendation
    recommendationText.textContent =
        data.recommendation || 'No recommendation available';

    results.classList.remove('hidden');
    results.scrollIntoView({ behavior: 'smooth' });
}
});