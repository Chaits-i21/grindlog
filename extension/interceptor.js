// Runs in the page's MAIN world (see manifest). Wraps fetch and XMLHttpRequest to
// capture the exact code sent to /problems/{slug}/submit/ and the submission id from
// its response. Verdict resolution happens in content.js, which polls LeetCode's
// check endpoint itself — so it doesn't matter how the page retrieves results
// (main thread, web worker, GraphQL, anything).
(() => {
  const SOURCE = 'grindlog';

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  }

  function handleSubmitResponse(url, requestBody, responseJson) {
    const m = url.match(/\/problems\/([^/]+)\/submit\/?/);
    if (!m || !responseJson || responseJson.submission_id == null) return;
    let body = {};
    try {
      body = typeof requestBody === 'string' ? JSON.parse(requestBody) : {};
    } catch {
      body = {};
    }
    console.log('[Grindlog] captured submit for', m[1], '— submission', responseJson.submission_id);
    post('submitted', {
      submissionId: String(responseJson.submission_id),
      code: body.typed_code || null,
      lang: body.lang || null,
      questionId: body.question_id || null,
      slug: m[1],
      submittedAt: Date.now(),
    });
  }

  function isSubmitUrl(method, url) {
    return method === 'POST' && url.includes('/problems/') && /\/submit\/?(\?|$)/.test(url);
  }

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!isSubmitUrl(method, url)) return origFetch.apply(this, arguments);

    const requestBodyPromise = init && typeof init.body === 'string'
      ? Promise.resolve(init.body)
      : (input instanceof Request ? input.clone().text().catch(() => '') : Promise.resolve(''));

    const respPromise = origFetch.apply(this, arguments);
    respPromise.then((resp) => {
      const jsonPromise = resp.clone().json();
      Promise.all([requestBodyPromise, jsonPromise])
        .then(([body, j]) => handleSubmitResponse(url, body, j))
        .catch(() => {});
    }).catch(() => {});
    return respPromise;
  };

  // --- XMLHttpRequest (axios and older code paths use XHR) ---
  const xhrProto = XMLHttpRequest.prototype;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;

  xhrProto.open = function (method, url) {
    this.__plc = { method: String(method).toUpperCase(), url: String(url) };
    return origOpen.apply(this, arguments);
  };

  xhrProto.send = function (body) {
    const info = this.__plc;
    if (info && isSubmitUrl(info.method, info.url)) {
      this.addEventListener('load', () => {
        try {
          handleSubmitResponse(info.url, typeof body === 'string' ? body : '', JSON.parse(this.responseText));
        } catch {
          /* non-JSON response — ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  console.log('[Grindlog] interceptor armed on', window.location.pathname);
})();
