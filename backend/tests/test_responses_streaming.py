from open_webui.utils.middleware import handle_responses_streaming_event


def test_completed_event_preserves_streamed_output_when_final_output_is_empty():
    streamed_output = [
        {
            'type': 'message',
            'role': 'assistant',
            'status': 'completed',
            'content': [{'type': 'output_text', 'text': 'OK'}],
        }
    ]

    output, metadata = handle_responses_streaming_event(
        {
            'type': 'response.completed',
            'response': {
                'id': 'response-123',
                'output': [],
                'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
            },
        },
        streamed_output,
    )

    assert output == streamed_output
    assert metadata == {
        'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2},
        'done': True,
        'response_id': 'response-123',
    }
