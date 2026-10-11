"""真实 DeepSeek 返回格式及工具协议边界回归，不调用模型服务。"""
import json
import unittest

from fastapi import HTTPException

from backend.canvas_assistant_tools import parse_decision, validate_tool, decision_diagnostic


def dsml(name, parameters):
    body = ''.join(
        f'<｜｜DSML｜｜ parameter name="{key}" string="{str(isinstance(value, str)).lower()}">'
        f'{value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)}'
        '</｜｜DSML｜｜ parameter>'
        for key, value in parameters.items())
    return f'<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="{name}">{body}</｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>'


class AssistantProtocolTests(unittest.TestCase):
    def test_protocol_diagnostics_keep_shape_without_private_content(self):
        text = '{"reply":"private-story","tool":null,"arguments":{},"secret":"private-key"} trailing'
        result = decision_diagnostic(text)
        self.assertEqual(result['format'], 'json')
        self.assertEqual(result['suffixLength'], 8)
        self.assertEqual(result['unknownFieldCount'], 1)
        self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(decision_diagnostic('{"reply":')['format'], 'invalid_json')

    def test_deepseek_wrapped_arguments_create_is_a_validated_operation(self):
        operations = [{'op': 'create', 'operationId': 'story', 'ref': 'story',
                       'type': 'prompt', 'title': '故事', 'content': '她找到旧信。\n雨停了。'}]
        choice = parse_decision(dsml('apply_canvas_operations', {'arguments': {'operations': operations}, 'tool': 'apply_canvas_operations'}))
        self.assertEqual(choice.tool, 'apply_canvas_operations')
        self.assertEqual(validate_tool(choice.tool, choice.arguments)['operations'][0]['content'], operations[0]['content'])

    def test_deepseek_direct_parameters_and_empty_arguments(self):
        choice = parse_decision(dsml('read_canvas', {'limit': 50}))
        self.assertEqual(choice.tool, 'read_canvas')
        self.assertEqual(validate_tool(choice.tool, choice.arguments)['limit'], 50)
        self.assertEqual(parse_decision(dsml('read_canvas', {})).arguments, {})

    def test_malformed_duplicate_multiple_and_mismatched_calls_are_not_prose(self):
        call = dsml('read_canvas', {'limit': 50})
        parameter = '<｜｜DSML｜｜ parameter name="limit" string="false">50</｜｜DSML｜｜ parameter>'
        invalid = [call[:-10], call + call, '我将创建节点。\n' + call, call + '\n创建完成。',
                   call.replace(parameter, parameter + parameter),
                   call.replace('>50<', '>not-json<'),
                   dsml('read_canvas', {'arguments': {}, 'tool': 'delete_canvas'}),
                   dsml('read_canvas', {'arguments': {}, 'limit': 50}),
                   call.replace('string="false"', 'string="unknown"')]
        for text in invalid:
            with self.subTest(text=text):
                with self.assertRaises(HTTPException) as caught:
                    parse_decision(text)
                self.assertEqual(caught.exception.status_code, 422)

    def test_dsml_does_not_expand_tool_or_parameter_permissions(self):
        for text in [dsml('delete_canvas', {}), dsml('read_canvas', {'path': 'private'})]:
            choice = parse_decision(text)
            with self.assertRaises(HTTPException):
                validate_tool(choice.tool, choice.arguments)

    def test_plain_story_and_existing_json_remain_supported(self):
        self.assertIsNone(parse_decision('故事里提到了 DSML，但没有请求工具。').tool)
        choice = parse_decision('{"reply":"读取","tool":"read_canvas","arguments":{}}')
        self.assertEqual(choice.tool, 'read_canvas')

    def test_real_deepseek_explanation_then_single_json_is_a_tool_call(self):
        text = '我先读取创作方法规则，再一次性落地文案与分镜节点。\n\n' + json.dumps({
            'reply': '先读取项目创作方法章节，确认文案/分镜落地规则。',
            'tool': 'read_project_knowledge',
            'arguments': {'capabilityId': 'project.creation', 'section': 'overview'}}, ensure_ascii=False)
        choice = parse_decision(text)
        self.assertEqual(choice.tool, 'read_project_knowledge')
        self.assertEqual(validate_tool(choice.tool, choice.arguments)['capabilityId'], 'project.creation')

    def test_mixed_json_still_rejects_multiple_incomplete_or_unknown_tool_calls(self):
        call = '{"reply":"读取","tool":"read_canvas","arguments":{}}'
        for text in ['我先读取。\n' + call + call, '我先读取。\n' + call[:-1],
                     '我先读取。\n' + call + '\n已经完成全部操作。']:
            with self.subTest(text=text), self.assertRaises(HTTPException):
                parse_decision(text)
        choice = parse_decision('接下来调用。\n{"reply":"","tool":"delete_canvas","arguments":{}}')
        with self.assertRaises(HTTPException):
            validate_tool(choice.tool, choice.arguments)
        self.assertIsNone(parse_decision('故事中的字条写着 {"word":"雨"}。').tool)


if __name__ == '__main__':
    unittest.main()
