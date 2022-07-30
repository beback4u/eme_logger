/**
 * Copyright 2015 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Handles the button control events and appends logs for the actual log window.
 */
document.addEventListener('DOMContentLoaded', function () {
  const clearButton = document.querySelector('#clear-button');
  if (clearButton != null) {
    clearButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'EME_LOGGER_CLEAR' });

      const list = document.getElementById('eme-log');
      while (list.hasChildNodes()) {
        list.removeChild(list.firstChild);
      }
    });
  }

  const downloadButton = document.querySelector('#download-button');
  if (downloadButton != null) {
    downloadButton.addEventListener('click', async function () {
      // Get the text logs from the log window.
      const response = await chrome.runtime.sendMessage({ type: 'EME_LOGGER_GET_TEXT_LOGS' });
      const blob = new Blob([response.textLogs], { type: 'text/plain' });

      // Trigger a download
      chrome.downloads.download({
        url: URL.createObjectURL(blob),
        filename: 'EMELogFile.txt'
      });
    });
  }
});

// NOTE: These APIs are not defined in our test environment, but should always
// be present when this is run as a Chrome extension.
if (chrome.runtime !== undefined) {
  /**
   * Listens for messages from the content script to append a log item to the
   * current frame and log file.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const textLog = appendLog(request.log);
    chrome.runtime.sendMessage({ type: 'EME_LOGGER_APPEND_LOG', data: textLog });
  });
}

/**
 * @param {Object} The serialized log to format in HTML.
 * @return {string} The text log.
 */
// TODO(joeyparrish): cleanup here, and I'll restructure/rename this part after this is merged.
function appendLog(log) {
  const logElement = document.querySelector('#eme-log');
  const li = document.createElement('li');
  logElement.appendChild(li);

  const heading = document.createElement('h3');
  li.appendChild(heading);

  const time = document.createElement('div');
  time.classList.add('time');
  heading.appendChild(time);
  heading.appendChild(document.createElement('br'));

  const instanceId = document.createElement('div');
  instanceId.classList.add('instance-id');
  heading.appendChild(instanceId);
  heading.appendChild(document.createElement('br'));

  const title = document.createElement('div');
  title.classList.add('title');
  heading.appendChild(title);

  const timestamp = new Date(log.timestamp);
  const formattedTimestamp = timestamp.toString();

  time.textContent = formattedTimestamp;
  if (log.duration) {
    time.textContent += ` - duration: ${log.duration.toFixed(1)} ms`;
  }

  instanceId.textContent = log.instanceId;

  const data = document.createElement('pre');
  data.classList.add('data');
  li.appendChild(data);

  if (log.type == 'Warning') {
    title.textContent = 'WARNING';
    title.classList.add('warning');
    data.textContent = log.message;
  }

  if (log.type == 'Constructor') {
    title.textContent = `new ${log.className}`;
  } else if (log.type == 'Method') {
    title.textContent = `${log.className}.${log.methodName}`;
  } else if (log.type == 'Getter' || log.type == 'Setter') {
    title.textContent = `${log.className}.${log.memberName}`;
  } else if (log.type == 'Event') {
    title.textContent = `${log.className} ${log.eventName} Event`;
  }

  if (log.type == 'Constructor' || log.type == 'Method') {
    const args = log.args.map(arg => prettyPrint(arg)).join(', ');
    data.textContent = `${title.textContent}(${args})`;

    if (log.threw) {
      data.textContent += ` threw ${prettyPrint(log.threw)}`;
    } else {
      data.textContent += ` => ${prettyPrint(log.result)}`;
    }
  } else if (log.type == 'Getter') {
    data.textContent = title.textContent;

    if (log.threw) {
      data.textContent += ` threw ${prettyPrint(log.threw)}`;
    } else {
      data.textContent += ` => ${prettyPrint(log.result)}`;
    }
  } else if (log.type == 'Setter') {
    data.textContent = title.textContent;

    if (log.threw) {
      data.textContent += ` threw ${prettyPrint(log.threw)}`;
    } else {
      data.textContent += ` => ${prettyPrint(log.value)}`;
    }
  } else if (log.type == 'Event') {
    data.textContent = `${log.className} `;
    if (!log.event.__type__) {
      // If the event object didn't properly inherit from Event, then we may
      // be missing type info.  Construct it now with the event name.
      data.textContent += `${log.eventName} Event instance `;
    }
    data.textContent += prettyPrint(log.event);
    if ('value' in log) {
      data.textContent += '\nAssociated value: ' + prettyPrint(log.value);
    }
  }
  return formattedTimestamp + '\n\n' +
    instanceId.textContent + '\n' +
    data.textContent + '\n\n\n\n';
}

/**
 * @param {number} byte
 * @return {string}
 */
function byteToHex(byte) {
  return '0x' + byte.toString(16).padStart(2, '0');
}

/**
 * @param {*} obj
 * @param {string} indentation
 * @return {string}
 */
function prettyPrint(obj, indentation = '') {
  if (obj == null) {
    return obj;
  }

  // If it's a named type, unpack it and attach the name.
  if (obj.__type__) {
    let format = obj.__type__ + ' instance';

    // This has fields like an object.
    if (obj.__fields__) {
      format += ' ' + prettyPrint(obj.__fields__, indentation);
    }

    // This has a data array like an ArrayBufferView.
    // TODO: Handle formatting for 16-bit and 32-bit values?
    if (obj.__data__) {
      const data = obj.__data__.slice();  // Make a copy
      if (data.length == 0) {
        format += '[]';
      } else {
        format += ' ' + '[\n';
        while (data.length) {
          const row = data.splice(0, 16);
          format += indentation + '  ';
          format += row.map(byteToHex).join(', ');
          format += ',\n';
        }
        format += indentation + ']';
      }
    }
    return format;
  }

  if (Array.isArray(obj)) {
    // More compact representations for empty or 1-element arrays.
    if (obj.length == 0) {
      return '[]';
    }
    if (obj.length == 1) {
      return `[${prettyPrint(obj[0], indentation)}]`;
    }

    let insides = '';
    for (const entry of obj) {
      insides += indentation + '  ';
      insides += prettyPrint(entry, indentation + '  ') + ',\n';
    }
    return `[\n${insides}${indentation}]`;
  }

  if (obj.constructor == Object) {
    const keys = Object.keys(obj);

    // More compact representations for empty or 1-element objects.
    if (keys.length == 0) {
      return '{}';
    }
    if (keys.length == 1) {
      return `{${keys[0]}: ${prettyPrint(obj[keys[0]], indentation)}}`;
    }

    let insides = '';
    for (const key of keys) {
      insides += indentation + '  ' + key + ': ';
      insides += prettyPrint(obj[key], indentation + '  ') + ',\n';
    }
    return `{\n${insides}${indentation}}`;
  }

  if (typeof obj == 'string') {
    return `"${obj}"`;
  }

  return obj.toString();
}
