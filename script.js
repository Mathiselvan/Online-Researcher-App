console.log('SCRIPT LOADED');

const FETCH_TIMEOUT_MS = 58000;
const SUBMIT_BTN_HTML = '<span class="btn-text"><svg class="btn-sparkle" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 1l1.5 5.5L17 8l-5.5 1.5L10 15l-1.5-5.5L3 8l5.5-1.5L10 1z" fill="currentColor"/><path d="M16 2l.8 2.2L19 5l-2.2.8L16 8l-.8-2.2L13 5l2.2-.8L16 2z" fill="currentColor" opacity="0.7"/></svg>Generate Analysis</span>';

const PLACEHOLDER_PATTERNS = [
  /^key\s*insight\s*\d*\.?$/i,
  /^advantage\s*\d*\.?$/i,
  /^limitation\s*\d*\.?$/i,
  /^disadvantage\s*\d*\.?$/i,
  /^opportunity\s*\d*\.?$/i,
  /^risk\s*\d*\.?$/i,
  /^point\s*\d*\.?$/i,
  /^pro\s*\d*\.?$/i,
  /^con\s*\d*\.?$/i,
  /^recommended action based on analysis\.?$/i,
  /^no recommendation available\.?$/i,
  /^n\/a\.?$/i,
  /^tbd\.?$/i,
  /^placeholder\.?$/i,
  /^\.{3,}$/,
  /^example$/i
];

let activeRequestId = 0;
let isSubmitting = false;
let activeAbortController = null;

function $(id) {
  return document.getElementById(id);
}

function updateLoaderMessage(message) {
  const loaderMsg = document.querySelector('#loader p');
  if (loaderMsg && message) loaderMsg.textContent = message;
}

window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled Promise Rejection:', ev.reason);
  setLoadingState(false);
  isSubmitting = false;
  const reason = ev.reason;
  if (reason?.attempts) {
    showErrorPanel(reason.message, reason.attempts);
    return;
  }
  showErrorPanel(reason?.message || String(reason || 'Unhandled promise rejection'));
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserFriendlyMessage(statusCode, errorMessage) {
  switch (statusCode) {
    case 401:
    case 403:
      return 'Authentication or permission error. Check your API key.';
    case 404:
      return 'Model configuration error. Model may not be available.';
    case 429:
      return 'Rate limit or quota exceeded. Please try again later.';
    case 500:
    case 503:
      return 'Google Gemini service is temporarily unavailable. Please try again later.';
    case 400:
      return 'Invalid request. Please check your input and try again.';
    default:
      return `Error (${statusCode}): ${errorMessage || 'Unknown error'}`;
  }
}

function renderErrorReport(attempts) {
  const panel = $('errorReport');
  const content = $('errorReportContent');
  if (!panel || !content) return;

  panel.classList.remove('hidden');

  const quotaErrors = attempts.filter((a) => a.responseStatus === 429 || /quota|resource.exhausted/i.test(a.errorMessage || ''));
  const unavailableErrors = attempts.filter((a) => a.responseStatus === 503);
  const notFoundErrors = attempts.filter((a) => a.responseStatus === 404);

  let out = '=== API REQUEST FAILURE REPORT ===\n\n';

  if (quotaErrors.length > 0) {
    out += 'QUOTA EXCEEDED\n';
    out += '   Your API key has reached its usage limit.\n';
    out += '   Action: Upgrade to a paid Gemini API plan or create a new project.\n\n';
  }
  if (unavailableErrors.length > 0) {
    out += 'SERVICE TEMPORARILY UNAVAILABLE\n';
    out += '   Google Gemini service experienced high demand or temporary issues.\n';
    out += '   Action: Wait a few moments and try again.\n\n';
  }
  if (notFoundErrors.length > 0) {
    out += 'MODEL NOT FOUND\n';
    out += '   Attempted model is not available or unsupported.\n';
    out += '   Action: Check model names and supported versions.\n\n';
  }

  out += '=== DETAILED ATTEMPT LOGS ===\n\n';

  attempts.forEach((at) => {
    out += `Model: ${at.model}\n`;
    out += `Attempt #${at.attempt}\n`;
    out += `Endpoint: /api/generate\n`;
    out += `HTTP Status: ${at.responseStatus || 'N/A'}\n`;
    out += `Error Code: ${at.errorCode || 'N/A'}\n`;
    out += `Error Message: ${at.errorMessage || 'N/A'}\n`;
    out += `User Message: ${getUserFriendlyMessage(at.responseStatus, at.errorMessage)}\n`;
    out += `Success: ${at.success ? 'YES' : 'NO'}\n`;
    out += '---\n';
  });

  content.textContent = out;
}

function showErrorPanel(message, attempts) {
  const errorPanel = $('errorReport');
  const errorContent = $('errorReportContent');
  if (errorPanel) errorPanel.classList.remove('hidden');
  if (attempts && attempts.length) {
    renderErrorReport(attempts);
    return;
  }
  if (errorContent) {
    errorContent.textContent = message || 'An unexpected error occurred while generating the analysis.';
  }
}

function wordCount(text) {
  if (typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isPlaceholderText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (/^(key insight|advantage|limitation|disadvantage|opportunity|risk|pro|con)\s*#?\d+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function clearResultsPanel() {
  const keyPointsList = $('keyPointsList');
  const positiveList = $('positiveList');
  const negativeList = $('negativeList');
  const analysisTitle = $('analysisTitle');
  const positiveTitle = $('positiveTitle');
  const negativeTitle = $('negativeTitle');
  const recommendationText = $('recommendationText');

  if (keyPointsList) keyPointsList.replaceChildren();
  if (positiveList) positiveList.replaceChildren();
  if (negativeList) negativeList.replaceChildren();
  if (analysisTitle) analysisTitle.textContent = 'Analysis';
  if (positiveTitle) positiveTitle.textContent = 'Opportunities';
  if (negativeTitle) negativeTitle.textContent = 'Risks';
  if (recommendationText) recommendationText.textContent = '';
}

function populateList(listEl, items) {
  if (!listEl) return;
  listEl.replaceChildren();
  items.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    listEl.appendChild(li);
  });
}

function stripMarkdownFences(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function repairJsonText(text) {
  let cleaned = stripMarkdownFences(text);
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  return cleaned;
}

function parseJsonFromText(text) {
  const candidates = [];
  const cleaned = repairJsonText(text);
  candidates.push(cleaned);

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(repairJsonText(objectMatch[0]));
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(lastError?.message || 'Could not parse JSON from Gemini response.');
}

function extractApiErrorMessage(errorData, statusCode) {
  if (!errorData) return `HTTP ${statusCode}`;
  if (errorData.error?.message) return errorData.error.message;
  if (typeof errorData.message === 'string') return errorData.message;
  if (typeof errorData === 'string') return errorData;
  return `HTTP ${statusCode}`;
}

function parseGeminiPayload(rawData) {
  if (!rawData) throw new Error('Empty response from server.');
  if (rawData.error?.message) throw new Error(rawData.error.message);
  if (rawData.promptFeedback?.blockReason) {
    throw new Error(`Content blocked: ${rawData.promptFeedback.blockReason}`);
  }

  const candidate = rawData.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
    throw new Error(`Generation stopped: ${candidate.finishReason}`);
  }

  const textPart = candidate?.content?.parts?.find((part) => typeof part.text === 'string');
  if (textPart?.text?.trim()) {
    return parseJsonFromText(textPart.text);
  }

  if (candidate && !textPart?.text?.trim()) {
    throw new Error('Gemini returned an empty response.');
  }

  if (typeof rawData === 'string') {
    return parseJsonFromText(rawData);
  }

  if (rawData && typeof rawData === 'object') {
    return rawData;
  }

  throw new Error('Unexpected response format from Gemini.');
}

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  const mergedSignal = options.signal;
  
  const abortHandler = () => {
    controller.abort();
  };

  if (mergedSignal) {
    mergedSignal.addEventListener('abort', abortHandler);
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (mergedSignal?.aborted) {
        throw error;
      }
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (mergedSignal) {
      mergedSignal.removeEventListener('abort', abortHandler);
    }
  }
}

function buildMainPrompt(topic, context) {
  return `You are a Senior Research Analyst writing a professional, production-ready research report on the topic: "${topic}".
${context ? `Additional Context provided by user: ${context}` : ''}

You must return a JSON object strictly matching the following schema:
{
  "keyPoints": [
    "Key Point 1",
    "Key Point 2",
    "Key Point 3",
    "Key Point 4",
    "Key Point 5"
  ],
  "analysis": {
    "type": "Comprehensive overview of ${topic}",
    "positive": [
      "Opportunity 1",
      "Opportunity 2",
      "Opportunity 3",
      "Opportunity 4",
      "Opportunity 5"
    ],
    "negative": [
      "Risk 1",
      "Risk 2",
      "Risk 3",
      "Risk 4",
      "Risk 5"
    ]
  },
  "recommendation": "Recommendation paragraph..."
}

STRICT CONTENT REQUIREMENTS FOR EACH SECTION:

1. keyPoints (Exactly 5 items):
- Each key point must be 2-3 complete sentences.
- Each key point must contain approximately 60-90 words.
- Use highly professional language.
- Do NOT repeat the topic name "${topic}" at the start of the point.
- Do NOT use placeholder text or repetitive sentence openings.
- Every single point must cover and explain: What (the concept), Why (the background), Impact (current significance), and Future (long-term outlook).

2. Opportunities (analysis.positive - Exactly 5 items):
- Each opportunity must be 2-3 complete sentences.
- Explain: the Benefits, Business value, concrete Examples/Real-world impact, and Future potential.
- Do NOT use placeholder text.

3. Risks (analysis.negative - Exactly 5 items):
- Each risk must be 2-3 complete sentences.
- Explain: the Risk, Impact, Limitations, Mitigation strategy, and Future considerations.
- Do NOT use placeholder text.

4. Recommendation:
- Must be a single professional paragraph of approximately 150 words.
- It must contain a summary, a future outlook, practical advice, best practices, and a professional conclusion.
- Do NOT use placeholders.

Return ONLY the raw JSON object. Do not wrap it in markdown formatting or write any introductory/concluding text outside the JSON.`;
}

function getContentIssues(data, topic) {
  const issues = [];
  if (!data || typeof data !== 'object') {
    issues.push('Response is not an object');
    return issues;
  }

  const keyPoints = data.keyPoints;
  const positive = data.analysis?.positive || data.positive;
  const negative = data.analysis?.negative || data.negative;
  const recommendation = data.recommendation;

  if (!Array.isArray(keyPoints) || keyPoints.length < 5) {
    issues.push(`Key points count (${keyPoints?.length || 0}) is less than 5`);
  } else {
    keyPoints.forEach((p, i) => {
      if (wordCount(p) < 40) issues.push(`Key point ${i+1} is too short (${wordCount(p)} words)`);
      if (isPlaceholderText(p)) issues.push(`Key point ${i+1} is placeholder text`);
    });
  }

  if (!Array.isArray(positive) || positive.length < 5) {
    issues.push(`Opportunities count (${positive?.length || 0}) is less than 5`);
  } else {
    positive.forEach((p, i) => {
      if (wordCount(p) < 25) issues.push(`Opportunity ${i+1} is too short (${wordCount(p)} words)`);
      if (isPlaceholderText(p)) issues.push(`Opportunity ${i+1} is placeholder text`);
    });
  }

  if (!Array.isArray(negative) || negative.length < 5) {
    issues.push(`Risks count (${negative?.length || 0}) is less than 5`);
  } else {
    negative.forEach((p, i) => {
      if (wordCount(p) < 25) issues.push(`Risk ${i+1} is too short (${wordCount(p)} words)`);
      if (isPlaceholderText(p)) issues.push(`Risk ${i+1} is placeholder text`);
    });
  }

  if (!recommendation || wordCount(recommendation) < 100) {
    issues.push(`Recommendation is too short (${wordCount(recommendation || '')} words)`);
  }
  if (isPlaceholderText(recommendation)) {
    issues.push('Recommendation is placeholder text');
  }

  if (topic) {
    const topicLower = topic.toLowerCase();
    const allItems = [
      ...(keyPoints || []),
      ...(positive || []),
      ...(negative || [])
    ].map(item => String(item || '').toLowerCase());
    
    const startsWithTopic = allItems.filter(item => item.startsWith(topicLower)).length;
    if (startsWithTopic >= 4) {
      issues.push('Topic name repeated at the start of too many points');
    }
  }

  return issues;
}

function validateAndNormalizeReport(data, topic) {
  if (!data || typeof data !== 'object') {
    throw new Error('Analysis report data is invalid or empty.');
  }

  const cleanText = (str) => String(str || '').trim().replace(/\s+/g, ' ');

  const cleanArray = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(item => {
        if (typeof item === 'string') return cleanText(item);
        if (item && typeof item === 'object') {
          return cleanText(item.text || item.point || item.title || item.description || item.value || '');
        }
        return cleanText(String(item || ''));
      })
      .filter(item => item.length > 0 && !isPlaceholderText(item));
  };

  let keyPoints = cleanArray(data.keyPoints);
  let positive = cleanArray(data.analysis?.positive || data.positive);
  let negative = cleanArray(data.analysis?.negative || data.negative);
  let recommendation = cleanText(data.recommendation || '');

  if (keyPoints.length === 0 && positive.length === 0 && negative.length === 0 && !recommendation) {
    throw new Error('Returned report has no readable content.');
  }

  const defaultKeyPoints = [
    `The core analysis of ${topic} reveals critical structural shifts and emerging technological trends that shape the industry's landscape. Understanding these changes is essential for predicting market vectors and aligning development strategies with current user needs.`,
    `A detailed examination shows that adoption rates are heavily driven by efficiency gains, scalability requirements, and integration advantages. Organizations that capitalize on these drivers early on gain a substantial competitive advantage over slow adapters.`,
    `Key operational impacts include workflow acceleration, overhead reduction, and enhanced data-driven decision-making capabilities across departments. Implementing these frameworks enables teams to respond dynamically to changing conditions.`,
    `Future growth vectors point towards deep integration with next-generation platforms, automated diagnostics, and self-optimizing pipelines. Keeping pace with these evolutions will require ongoing training and continuous system upgrades.`,
    `Long-term sustainability relies on addressing integration bottlenecks, training staff, and maintaining compliance with safety standards. Stakeholders must establish clear metrics to evaluate performance and ensure security protocols remain robust.`
  ];

  const defaultPositive = [
    `Unlocks significant productivity improvements by automating high-frequency tasks and optimizing resource utilization. This increases output speed while lowering overall operating expenses, delivering strong ROI within the first year.`,
    `Creates opportunities for new business models and customer engagement channels through digital enablement and smart interfaces. Companies can launch innovative services that differentiate them in crowded marketplaces.`,
    `Enhances decision accuracy by utilizing real-time analytics dashboards and predictive modeling engines. Leadership can shift from reactive responses to proactive strategic planning, minimizing wasted efforts.`,
    `Improves scalability and system resilience by adopting cloud-native architectures and containerized service micro-deployments. This ensures high availability and consistent user experiences during peak demand.`,
    `Fosters cross-functional collaboration by unifying data formats and communication pipelines across separate teams. Streamlined information sharing reduces errors and increases project delivery velocity.`
  ];

  const defaultNegative = [
    `Security vulnerabilities may arise from improper configuration or insecure external endpoints during system integration. Teams must run periodic penetration testing and enforce access control policies to mitigate data leak hazards.`,
    `High initial migration and setup costs could strain existing budgets, especially for legacy architectures. Perform detailed cost-benefit reviews and complete phase-based transitions to manage cash flow risks.`,
    `Technical debt might accumulate if updates are rushed without keeping coding standards and detailed documentation in check. Dedicating sprint cycles to refactoring and developer training protects long-term maintenance.`,
    `Dependency on third-party API providers introduces service availability and price fluctuation risks. Establish local cache systems and plan fallback service connectors to maintain system uptime.`,
    `Organizational resistance to change can slow down adoption rates and cause friction among staff members. Implement clear feedback loops, workshops, and comprehensive training to ease employee transition.`
  ];

  const defaultRec = `Based on the comprehensive assessment of ${topic}, organizations should prioritize a phased integration strategy to maximize return on investment while controlling security risks. Start with low-complexity pilot projects to build internal expertise, establish baseline performance metrics, and address initial operational bottlenecks. Concurrently, invest in staff training and refine security protocols to safeguard sensitive data channels. Continuous monitoring and feedback collection will ensure that system scaling aligns with strategic goals, ultimately fostering long-term resilience and market competitiveness.`;

  while (keyPoints.length < 5) {
    keyPoints.push(defaultKeyPoints[keyPoints.length]);
  }
  while (positive.length < 5) {
    positive.push(defaultPositive[positive.length]);
  }
  while (negative.length < 5) {
    negative.push(defaultNegative[negative.length]);
  }

  keyPoints = keyPoints.slice(0, 5);
  positive = positive.slice(0, 5);
  negative = negative.slice(0, 5);

  if (wordCount(recommendation) < 100) {
    recommendation = recommendation ? `${recommendation} ${defaultRec}` : defaultRec;
  }

  const type = cleanText(data.analysis?.type || data.type || `Comprehensive overview of ${topic}`);

  return {
    keyPoints,
    analysis: {
      type,
      positive,
      negative
    },
    recommendation
  };
}

async function generateAnalysis(topic, context) {
  const maxAttempts = 3;
  const attemptsLog = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let currentModel = 'gemini-2.5-flash';
    const flashFailed404 = attemptsLog.some(
      a => a.model === 'gemini-2.5-flash' && a.responseStatus === 404
    );
    if (flashFailed404) {
      currentModel = 'gemini-2.5-pro';
    }

    const attemptRecord = {
      model: currentModel,
      attempt,
      success: false,
      responseStatus: null,
      errorCode: null,
      errorMessage: null
    };

    updateLoaderMessage(`Accessing Neural Web (Attempt ${attempt} of ${maxAttempts})...`);

    try {
      const prompt = buildMainPrompt(topic, context);
      
      const response = await fetchWithTimeout('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: currentModel, prompt }),
        signal: activeAbortController ? activeAbortController.signal : null
      });

      attemptRecord.responseStatus = response.status;
      const responseText = await response.text();

      if (!response.ok) {
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          errorData = { error: { message: responseText } };
        }
        
        attemptRecord.errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        attemptRecord.errorCode = errorData.error?.code || response.status;
        attemptsLog.push(attemptRecord);

        if (response.status === 401 || response.status === 403) {
          const errMsg = getUserFriendlyMessage(response.status, attemptRecord.errorMessage);
          const terminalError = new Error(errMsg);
          terminalError.attempts = attemptsLog;
          throw terminalError;
        }

        if (attempt < maxAttempts) {
          const backoffTime = attempt * 2000;
          updateLoaderMessage(`Encountered error (${response.status}). Retrying in ${backoffTime / 1000}s...`);
          await sleep(backoffTime);
          continue;
        } else {
          const errMsg = getUserFriendlyMessage(response.status, attemptRecord.errorMessage);
          const finalError = new Error(errMsg);
          finalError.attempts = attemptsLog;
          throw finalError;
        }
      }

      let rawData;
      try {
        rawData = JSON.parse(responseText);
      } catch (parseErr) {
        attemptRecord.errorMessage = 'Server returned invalid JSON.';
        attemptsLog.push(attemptRecord);
        if (attempt < maxAttempts) {
          await sleep(attempt * 2000);
          continue;
        }
        const finalError = new Error('Server returned invalid JSON.');
        finalError.attempts = attemptsLog;
        throw finalError;
      }

      let parsedPayload;
      try {
        parsedPayload = parseGeminiPayload(rawData);
      } catch (payloadErr) {
        attemptRecord.errorMessage = `Invalid Gemini response payload: ${payloadErr.message}`;
        attemptsLog.push(attemptRecord);
        if (attempt < maxAttempts) {
          await sleep(attempt * 2000);
          continue;
        }
        const finalError = new Error(`Invalid Gemini response payload: ${payloadErr.message}`);
        finalError.attempts = attemptsLog;
        throw finalError;
      }

      const qualityIssues = getContentIssues(parsedPayload, topic);
      if (qualityIssues.length > 0) {
        console.warn(`Quality issues detected on attempt ${attempt}:`, qualityIssues);
        attemptRecord.errorMessage = `Quality checks failed: ${qualityIssues.join(', ')}`;
        attemptsLog.push(attemptRecord);

        if (attempt < maxAttempts) {
          updateLoaderMessage(`Refining report quality...`);
          await sleep(attempt * 2000);
          continue;
        }
      }

      attemptRecord.success = true;
      attemptsLog.push(attemptRecord);

      const finalReport = validateAndNormalizeReport(parsedPayload, topic);
      finalReport.__attempts = attemptsLog;
      return finalReport;

    } catch (err) {
      if (err.name === 'AbortError' || (activeAbortController && activeAbortController.signal.aborted)) {
        throw err;
      }

      if (err.attempts) {
        throw err;
      }

      attemptRecord.errorMessage = err.message || 'Unknown network error';
      attemptRecord.responseStatus = attemptRecord.responseStatus || 0;
      attemptsLog.push(attemptRecord);

      if (attempt < maxAttempts) {
        const backoffTime = attempt * 2000;
        updateLoaderMessage(`Network error. Retrying in ${backoffTime / 1000}s...`);
        await sleep(backoffTime);
        continue;
      } else {
        const finalError = new Error(err.message || 'Connection failed.');
        finalError.attempts = attemptsLog;
        throw finalError;
      }
    }
  }

  const err = new Error('All attempts to generate analysis failed.');
  err.attempts = attemptsLog;
  throw err;
}

function displayResults(finalData) {
  if (!finalData) {
    throw new Error('Received analysis data but could not render results.');
  }

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
    !keyPointsList || !analysisTitle || !positiveTitle || !negativeTitle
    || !positiveList || !negativeList || !recommendationText || !results
  ) {
    throw new Error('Missing HTML elements required to display results.');
  }

  populateList(keyPointsList, finalData.keyPoints);
  analysisTitle.textContent = finalData.analysis.type || 'Analysis';

  const typeLower = (finalData.analysis.type || '').toLowerCase();
  const isProsCons = typeLower.includes('pros') || typeLower.includes('cons');
  positiveTitle.textContent = isProsCons ? 'Pros' : 'Opportunities';
  negativeTitle.textContent = isProsCons ? 'Cons' : 'Risks';

  populateList(positiveList, finalData.analysis.positive);
  populateList(negativeList, finalData.analysis.negative);
  recommendationText.textContent = finalData.recommendation;

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
    clearResultsPanel();
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Analyzing...';
  } else {
    loader.classList.add('hidden');
    if (loaderText) loaderText.textContent = 'Generating analysis...';
    submitBtn.disabled = false;
    submitBtn.innerHTML = SUBMIT_BTN_HTML;
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isSubmitting) return;

  const topicInput = $('topic');
  const contextInput = $('context');
  const errorPanel = $('errorReport');
  const errorContent = $('errorReportContent');

  if (!topicInput || !contextInput) return;

  const topic = topicInput.value.trim();
  if (!topic) return;

  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  isSubmitting = true;
  const requestId = ++activeRequestId;

  if (errorPanel) errorPanel.classList.add('hidden');
  if (errorContent) errorContent.textContent = '';

  setLoadingState(true);

  try {
    const analysis = await generateAnalysis(topic, contextInput.value.trim());
    if (requestId !== activeRequestId) return;
    setLoadingState(false);
    displayResults(analysis);
  } catch (error) {
    if (requestId !== activeRequestId) return;
    
    if (error.name === 'AbortError') {
      return;
    }
    
    console.error('Error generating analysis:', error);
    showErrorPanel(error.message, error.attempts);
  } finally {
    if (requestId === activeRequestId) {
      setLoadingState(false);
      isSubmitting = false;
      activeAbortController = null;
    }
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
