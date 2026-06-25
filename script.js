console.log('SCRIPT LOADED');

function $(id) {
  return document.getElementById(id);
}

window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled Promise Rejection:', ev.reason);
  const loaderMsg = document.querySelector('#loader p');
  if (loaderMsg) loaderMsg.textContent = ev.reason?.message || String(ev.reason || 'Unhandled promise rejection');
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function renderErrorReport(attempts) {
  const panel = $('errorReport');
  const content = $('errorReportContent');
  if (!panel || !content) return;

  panel.classList.remove('hidden');

  const quotaErrors = attempts.filter(a => a.responseStatus === 429 || /quota|resource.exhausted/i.test(a.errorMessage || ''));
  const unavailableErrors = attempts.filter(a => a.responseStatus === 503);
  const notFoundErrors = attempts.filter(a => a.responseStatus === 404);

  let out = '=== API REQUEST FAILURE REPORT ===\n\n';

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

async function fetchWithRetry(prompt, models = ['gemini-2.5-flash']) {
  const maxAttempts = 3;
  const backoff = [2000, 5000, 10000];
  const attemptsLog = [];

  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    console.log(`🚀 Trying model ${model}`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptRecord = {
        model,
        attempt: attempt + 1,
        request: { model, prompt },
        responseStatus: null,
        responseBody: null,
        success: false,
        errorCode: null,
        errorMessage: null
      };

      try {
        const url = '/api/generate';
        const payload = { model, prompt };

        console.log(`Attempt ${attempt + 1} – POST ${url} (model=${model})`);
        console.log('Request payload:', payload);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        attemptRecord.responseStatus = response.status;
        const responseText = await response.text();
        attemptRecord.responseBody = responseText;

        if (!response.ok) {
          let errorData;
          try {
            errorData = JSON.parse(responseText);
          } catch (parseErr) {
            errorData = { error: { message: responseText || `HTTP ${response.status}` } };
          }
          const message = errorData.error?.message || `HTTP ${response.status}`;
          attemptRecord.errorMessage = message;
          attemptRecord.errorCode = errorData.error?.code || errorData.error?.status || null;
          attemptsLog.push(attemptRecord);

          const isTransient = [429, 500, 503].includes(response.status)
            || /high demand|rate limit|quota|unavailable|resource\.exhausted/i.test(message);

          if (isTransient && attempt < maxAttempts - 1) {
            console.warn(`Transient error (${response.status}): ${message}`);
            throw new Error(message);
          }
          throw new Error(message);
        }

        let rawData;
        try {
          rawData = JSON.parse(responseText);
        } catch (parseErr) {
          rawData = responseText;
        }

        let parsed;
        if (rawData && rawData.candidates && rawData.candidates[0] && rawData.candidates[0].content) {
          const resultText = rawData.candidates[0].content.parts[0].text;
          const cleanedText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
          console.log('RAW GEMINI TEXT:', resultText);
          console.log('CLEANED GEMINI TEXT:', cleanedText);
          parsed = JSON.parse(cleanedText);
        } else if (typeof rawData === 'string') {
          parsed = JSON.parse(rawData);
        } else {
          parsed = rawData;
        }

        if (!parsed || !Array.isArray(parsed.keyPoints) || !parsed.analysis || !parsed.recommendation) {
          attemptRecord.errorMessage = 'Invalid JSON structure returned from Gemini.';
          attemptsLog.push(attemptRecord);
          throw new Error('Invalid Gemini response structure.');
        }

        attemptRecord.success = true;
        attemptsLog.push(attemptRecord);
        parsed.__attempts = attemptsLog;
        console.log('GEMINI SUCCESS', parsed);
        return parsed;
      } catch (error) {
        console.error(`❗ Attempt ${attempt + 1} failed for model ${model}:`, error);
        if (attempt === maxAttempts - 1) {
          if (!attemptsLog.find(a => a.model === model && a.attempt === attempt + 1)) {
            attemptRecord.errorMessage = error.message;
            attemptsLog.push(attemptRecord);
          }
          break;
        }
        const loaderMsg = document.querySelector('#loader p');
        if (loaderMsg) {
          loaderMsg.textContent = `Retry attempt ${attempt + 2} of ${maxAttempts}...`;
        }
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

  const error = new Error('All Gemini models failed. See error report for details.');
  error.attempts = attemptsLog;
  renderErrorReport(attemptsLog);
  throw error;
}

async function generateAnalysis(topic, context) {
  const promptText = `You are an expert Topic Research Assistant.\nTopic: ${topic}\nContext/Source: ${context || 'None provided'}\n\nProvide a structured analysis with the following sections EXACTLY:\n1. \"keyPoints\": Array of 5 strings (bullet points summarizing the topic).\n2. \"analysis\": { \"type\": \"string\", \"positive\": [\"string\"], \"negative\": [\"string\"] }\n3. \"recommendation\": \"string\"\n\nOutput ONLY valid JSON without any markdown formatting.`;
  const loaderMsg = document.querySelector('#loader p');
  if (loaderMsg) loaderMsg.textContent = 'Accessing Neural Web...';
  return fetchWithRetry(promptText);
}

function displayResults(data) {
  console.log('DISPLAY RESULTS CALLED', data);

  const errorPanel = $('errorReport');
  const errorContent = $('errorReportContent');
  if (errorPanel) errorPanel.classList.add('hidden');
  if (errorContent) errorContent.textContent = '';

  const keyPointsList = $('keyPointsList');
  const analysisTitle = $('analysisTitle');
  const positiveTitle = $('positiveTitle');
  const negativeTitle = $('negativeTitle');
  const positiveList = $('positiveList');
  const negativeList = $('negativeList');
  const recommendationText = $('recommendationText');
  const results = $('results');

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
    console.error('Missing HTML element(s) for rendering results:', {
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

  keyPointsList.innerHTML = '';
  (data.keyPoints || []).forEach(point => {
    const li = document.createElement('li');
    li.textContent = point;
    keyPointsList.appendChild(li);
  });

  analysisTitle.textContent = data.analysis?.type || 'Analysis';
  const isProsCons = (data.analysis?.type || '').toLowerCase().includes('pros');
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

  recommendationText.textContent = data.recommendation || 'No recommendation available';

  results.classList.remove('hidden');
  results.scrollIntoView({ behavior: 'smooth' });
}

function setLoadingState(isLoading) {
  const loader = $('loader');
  const results = $('results');
  const submitBtn = $('submitBtn');
  const loaderText = document.querySelector('#loader p');
  if (!loader || !results || !submitBtn) return;

  if (isLoading) {
    if (loaderText) loaderText.textContent = 'Generating analysis...';
    loader.classList.remove('hidden');
    results.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Analyzing...';
  } else {
    loader.classList.add('hidden');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-text">✨ Generate Analysis</span>';
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const topicInput = $('topic');
  const contextInput = $('context');
  const errorPanel = $('errorReport');
  const errorContent = $('errorReportContent');

  if (!topicInput || !contextInput) {
    console.error('Missing input fields in the page.');
    return;
  }

  if (errorPanel) errorPanel.classList.add('hidden');
  if (errorContent) errorContent.textContent = '';

  setLoadingState(true);

  try {
    const analysis = await generateAnalysis(topicInput.value.trim(), contextInput.value.trim());
    setLoadingState(false);
    displayResults(analysis);
  } catch (error) {
    console.error('Error generating analysis:', error);
    const loaderMsg = document.querySelector('#loader p');
    if (loaderMsg) loaderMsg.textContent = error.message || 'Failed to generate analysis.';
    if (errorPanel) errorPanel.classList.remove('hidden');
    if (errorContent) {
      errorContent.textContent = error.message || 'Unexpected error occurred.';
    }
  } finally {
    setLoadingState(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = $('researchForm');
  if (!form) {
    console.error('Missing researchForm element.');
    return;
  }
  form.addEventListener('submit', handleSubmit);
});

console.log('SCRIPT REACHED END');
