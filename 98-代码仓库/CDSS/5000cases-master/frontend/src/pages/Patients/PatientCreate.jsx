import { useState } from 'react'
import {
  Card,
  Form,
  Input,
  Button,
  Radio,
  DatePicker,
  Select,
  InputNumber,
  Typography,
  Row,
  Col,
  Space,
  Divider,
  message,
} from 'antd'
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { createPatient } from '../../api/patients'

const { Title } = Typography
const { TextArea } = Input

export default function PatientCreate() {
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const handleFinish = async (values) => {
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        birth_date: values.birth_date
          ? values.birth_date.format('YYYY-MM-DD')
          : undefined,
      }
      const res = await createPatient(payload)
      const newId = res.data?.id
      message.success('患者创建成功，请录入基线检查')
      if (newId) {
        navigate(`/patients/${newId}/baseline`)
      } else {
        navigate('/patients')
      }
    } catch (err) {
      const detail =
        err.response?.data?.detail || '创建失败，请检查填写内容后重试'
      message.error(detail)
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '24px' }}>
      <Row
        justify="space-between"
        align="middle"
        style={{ marginBottom: 24 }}
      >
        <Col>
          <Space align="center">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/patients')}
            >
              返回
            </Button>
            <Title level={4} style={{ margin: 0 }}>
              新建患者
            </Title>
          </Space>
        </Col>
      </Row>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        scrollToFirstError
      >
        {/* 基本信息 */}
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                label="姓名"
                name="name"
                rules={[{ required: true, message: '请输入患者姓名' }]}
              >
                <Input placeholder="请输入姓名" maxLength={50} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                label="性别"
                name="gender"
                rules={[{ required: true, message: '请选择性别' }]}
              >
                <Radio.Group>
                  <Radio value="male">男</Radio>
                  <Radio value="female">女</Radio>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                label="出生日期"
                name="birth_date"
                rules={[{ required: true, message: '请选择出生日期' }]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  placeholder="请选择出生日期"
                  disabledDate={(d) => d && d.isAfter(new Date())}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="就读年级" name="school_grade">
                <Input placeholder="例：小学三年级" maxLength={30} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 家庭因素 */}
        <Card title="家庭因素" style={{ marginBottom: 16 }}>
          <Row gutter={24}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item label="父母近视情况" name="parent_myopia">
                <Select placeholder="请选择" allowClear>
                  <Select.Option value="none">均无近视</Select.Option>
                  <Select.Option value="one">一方近视</Select.Option>
                  <Select.Option value="both">双方均近视</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                label="日均户外时间（小时）"
                name="outdoor_hours_per_day"
              >
                <InputNumber
                  min={0}
                  max={16}
                  step={0.5}
                  precision={1}
                  style={{ width: '100%' }}
                  placeholder="0 ~ 16"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                label="日均近距用眼时间（小时）"
                name="near_work_hours_per_day"
              >
                <InputNumber
                  min={0}
                  max={16}
                  step={0.5}
                  precision={1}
                  style={{ width: '100%' }}
                  placeholder="0 ~ 16"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 备注 */}
        <Card title="备注" style={{ marginBottom: 24 }}>
          <Form.Item name="notes" label="备注信息">
            <TextArea
              rows={4}
              placeholder="可填写患者其他相关信息（选填）"
              maxLength={500}
              showCount
            />
          </Form.Item>
        </Card>

        <Divider />

        <Row justify="end">
          <Col>
            <Space>
              <Button onClick={() => navigate('/patients')}>取消</Button>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={submitting}
              >
                保存并录入基线检查
              </Button>
            </Space>
          </Col>
        </Row>
      </Form>
    </div>
  )
}
