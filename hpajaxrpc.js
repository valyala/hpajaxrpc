/*
 * Copyright (c) 2011 Aliaksandr Valialkin (valyala@gmail.com)
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

hpajaxrpc = (function() {
  var statusCodes = {
    SUCCESS: 0,
    HTTP_ERROR: 1,
    JSON_STRINGIFY_ERROR: 2,
    JSON_PARSE_ERROR: 3,
    RESPONSE_CALLBACK_ERROR: 4,
  };

  var issueCallback = function(callback, arg1, arg2) {
    if (callback) {
      callback(arg1, arg2);
    }
  };

  var JsonRpc = function() {
    this._xhr = new XMLHttpRequest();
  };

  JsonRpc.prototype = {
    run: function(rpc_endpoint, request_data, response_callback,
        finalize_callback) {
      var request_text;
      try {
        request_text = JSON.stringify(request_data);
      }
      catch(e) {
        issueCallback(finalize_callback, statusCodes.JSON_STRINGIFY_ERROR, e);
        return;
      }
      var xhr = this._xhr;
      xhr.onreadystatechange = function() {
        if (xhr.readyState != 4) {
          return;
        }
        if (xhr.status != 200) {
          issueCallback(finalize_callback, statusCodes.HTTP_ERROR, xhr.status);
          return;
        }
        var response_data;
        try {
          response_data = JSON.parse(xhr.responseText);
        }
        catch(e) {
          issueCallback(finalize_callback, statusCodes.JSON_PARSE_ERROR, e);
          return;
        }
        if (response_callback) {
          try {
            response_callback(response_data);
          }
          catch(e) {
            issueCallback(finalize_callback,
                statusCodes.RESPONSE_CALLBACK_ERROR, e);
            return;
          }
        }
        issueCallback(finalize_callback, statusCodes.SUCCESS);
      };
      xhr.open('POST', rpc_endpoint, true);
      xhr.send(request_text);
    },
  };

  var QueuedRpc = function(base_rpc_call) {
    this._base_rpc_call = base_rpc_call;
    this._queued_rpc_args = [];
    this._is_rpc_in_flight = false;
  };

  QueuedRpc.prototype = {
    _startRpc: function(rpc_endpoint, request_data, response_callback,
        finalize_callback) {
      var that = this;
      var queued_finalize_callback = function(status_code, status_data) {
        if (that._queued_rpc_args.length > 0) {
          that._issueNextRpc();
        }
        else {
          that._is_rpc_in_flight = false;
        }
        issueCallback(finalize_callback, status_code, status_data);
      };
      this._base_rpc_call(rpc_endpoint, request_data, response_callback,
          queued_finalize_callback);
    },

    _issueNextRpc: function() {
      var rpc_args = this._queued_rpc_args.shift();
      this._startRpc.apply(this, rpc_args);
    },

    run: function(rpc_endpoint, request_data, response_callback,
        finalize_callback) {
      this._queued_rpc_args.push([rpc_endpoint, request_data, response_callback,
          finalize_callback]);
      if (!this._is_rpc_in_flight) {
        this._is_rpc_in_flight = true;
        this._issueNextRpc();
      }
    },
  };

  var BatchedRpc = function(base_rpc_call, batch_interval) {
    this._base_rpc_call = base_rpc_call;
    this._batch_interval = batch_interval;
    this._batched_rpc_args = [];
    this._is_rpc_in_flight = false;
    this._first_rpc_time = 0;
  };

  BatchedRpc.prototype = {
    _issueRpc: function() {
      var batched_request_data = [];
      var response_callbacks = [];
      var finalize_callbacks = [];
      this._batched_rpc_args.forEach(function(rpc_args) {
        batched_request_data.push(rpc_args[0]);
        response_callbacks.push(rpc_args[1]);
        finalize_callbacks.push(rpc_args[2]);
      });
      this._batched_rpc_args = [];
      var batched_response_callback = function(batched_response_data) {
        if (!(batched_response_data instanceof Array)) {
          throw 'batched_response_data=' +
              JSON.stringify(batched_response_data) +
              ' should be an instance of Array';
        }
        if (batched_response_data.length != response_callbacks.length) {
          throw 'unexpected batched_response_data size=' +
              batched_response_data.length + ', expected size=' +
              response_callbacks.length;
        }
        batched_response_data.forEach(function(response_data, index) {
          issueCallback(response_callbacks[index], response_data);
        });
      };
      var that = this;
      var batched_finalize_callback = function(status_code, status_data) {
        if (that._batched_rpc_args.length > 0) {
          that._issueRpcDelayed();
        }
        else {
          that._is_rpc_in_flight = false;
        }
        finalize_callbacks.forEach(function(finalize_callback) {
          // Make sure each finalize_callback is always called.
          try {
            issueCallback(finalize_callback, status_code, status_data);
          }
          catch(e) {
            // do nothing
          }
        });
      };
      this._base_rpc_call(batched_request_data, batched_response_callback,
          batched_finalize_callback);
    },

    _issueRpcDelayed: function() {
      var timeout = this._batch_interval - (Date.now() - this._first_rpc_time);
      if (timeout < 0) {
        timeout = 0;
      }
      var that = this;
      window.setTimeout(function() { that._issueRpc(); }, timeout);
    },

    run: function(request_data, response_callback, finalize_callback) {
      var batched_rpc_args = this._batched_rpc_args;
      if (batched_rpc_args.length == 0) {
        this._first_rpc_time = Date.now();
      }
      batched_rpc_args.push(
          [request_data, response_callback, finalize_callback]);
      if (!this._is_rpc_in_flight) {
        this._is_rpc_in_flight = true;
        this._issueRpcDelayed();
      }
    },
  };

  var RateLimitedRpc = function(base_rpc_call, rate_interval) {
    this._base_rpc_call = base_rpc_call;
    this._rate_interval = rate_interval;
    this._last_rpc_args = null;
    this._is_rpc_in_flight = false;
    this._rpc_time = 0;
  };

  RateLimitedRpc.prototype = {
    _issueRpcDelayed: function() {
      var timeout = this._rate_interval - (Date.now() - this._rpc_time);
      if (timeout < 0) {
        timeout = 0;
      }
      var that = this;
      window.setTimeout(function() {  that._issueRpc(); }, timeout);
    },

    _issueRpc: function() {
      var request_data = this._last_rpc_args[0];
      var response_callback = this._last_rpc_args[1];
      var finalize_callback = this._last_rpc_args[2];
      this._last_rpc_args = null;
      var that = this;
      var rate_limited_finalize_callback = function(status_code, status_data) {
        if (that._last_rpc_args !== null) {
          that._issueRpcDelayed();
        }
        else {
          that._is_rpc_in_flight = false;
        }
        issueCallback(finalize_callback, status_code, status_data);
      };
      this._base_rpc_call(request_data, response_callback,
          rate_limited_finalize_callback);
    },

    run: function(request_data, response_callback, finalize_callback) {
      if (this._last_rpc_args === null) {
        this._rpc_time = Date.now();
      }
      else {
        issueCallback(this._last_rpc_args[2], statusCodes.SUCCESS);
      }
      this._last_rpc_args = [request_data, response_callback,
          finalize_callback];
      if (!this._is_rpc_in_flight) {
        this._is_rpc_in_flight = true;
        this._issueRpc();
      }
    },
  };

  return {
    statusCodes: statusCodes,
    JsonRpc: JsonRpc,
    QueuedRpc: QueuedRpc,
    BatchedRpc: BatchedRpc,
    RateLimitedRpc: RateLimitedRpc,
  };
})();
