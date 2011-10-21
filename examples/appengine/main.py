#!/usr/bin/env python

from google.appengine.ext import webapp
from google.appengine.ext.webapp import util
from django.utils import simplejson


class JsonRequestHandler(webapp.RequestHandler):
  def post(self):
    request_text = self.request.body
    request_data = simplejson.loads(request_text)
    response_data = self.process_request(request_data)
    response_text = simplejson.dumps(response_data, separators=(',', ':'))
    self.response.out.write(response_text)

  def process_request(self, request_data):
    raise NotImplementedError


def echo_method(request_data):
  return request_data


def echo_authenticated_method(request_data):
  auth_token, request_data = request_data
  if auth_token != 'secret1':
    return [False]
  return [True, request_data]


def sum_method(request_data):
  a, b = request_data
  return a + b


class EchoRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    return echo_method(request_data)


class EchoAuthenticatedRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    return echo_authenticated_method(request_data)


class SumRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    return sum_method(request_data)


Methods = {
  'echo': echo_method,
  'sum': sum_method,
}


def multiplexor_method(request_data):
  method_name, request_data = request_data
  return Methods[method_name](request_data)


class MultiplexorRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    return multiplexor_method(request_data)


def process_request_batched(batched_request_data, request_handler):
  batched_response_data = []
  for request_data in batched_request_data:
    response_data = request_handler(request_data)
    batched_response_data.append(response_data)
  return batched_response_data


class MultiplexorBatchedRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    return process_request_batched(request_data, multiplexor_method)


class SumAuthenticatedBatchedRequestHandler(JsonRequestHandler):
  def process_request(self, request_data):
    auth_token, request_data = request_data
    if auth_token != 'secret2':
      return [False]
    response_data = process_request_batched(request_data, sum_method)
    return [True, response_data]


URL_MAP = [
    ('/echo', EchoRequestHandler),
    ('/echo-authenticated', EchoAuthenticatedRequestHandler),
    ('/sum', SumRequestHandler),
    ('/multiplexor', MultiplexorRequestHandler),
    ('/multiplexor-batched', MultiplexorBatchedRequestHandler),
    ('/sum-authenticated-batched', SumAuthenticatedBatchedRequestHandler),
]

# initialize the application only once. The main() is called with each request,
# so don't spend CPU time on repeated initialization of the application here.
application = webapp.WSGIApplication(URL_MAP, debug=True)


def main():
  util.run_wsgi_app(application)


if __name__ == '__main__':
  main()

