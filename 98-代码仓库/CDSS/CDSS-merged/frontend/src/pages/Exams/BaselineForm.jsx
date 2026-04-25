import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Form,
  DatePicker,
  InputNumber,
  Input,
  Button,
  Card,
  Divider,
  Typography,
  Space,
  message,
  Spin,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { getPatient } from '../../api/patients'
import { getBaseline, createBaseline, updateBaseline } from '../../api/exams'
import EyeDataForm from '../../components/EyeDataForm'

const { Title, Text } = Typography

export default function BaselineForm() {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isEdit, setIsEdit] = useState(false)
  const [patientName, setPatientName] = useState('')

  useEffect(() => {
    async function init() {
      setLoading(true)

      // Fetch patient info (non-fatal if it fails)
      try {
        const patRes = await getPatient(patientId)
        setPatientName(
          patRes.data.name || patRes.data.full_name || `患者 #${patientId}`
        )
      } catch {
        // ignore
      }

      // Try to load existing baseline
      try {
        const res = await getBaseline(patientId)
        const d = res.data
        setIsEdit(true)

        form.setFieldsValue({
          exam_date: d.exam_date ? dayjs(d.exam_date) : dayjs(),
          od: {
            sph: d.od_sph,
            cyl: d.od_cyl,
            axis: d.od_axis,
            va: d.od_va,
            al: d.od_al,
            k1: d.od_k1,
            k2: d.od_k2,
          },
          os: {
            sph: d.os_sph,
            cyl: d.os_cyl,
            axis: d.os_axis,
            va: d.os_va,
            al: d.os_al,
            k1: d.os_k1,
            k2: d.os_k2,
          },
          lens_brand: d.lens_brand,
          od_add: d.od_add,
          os_add: d.os_add,
        })
      } catch (err) {
        // 404 = no baseline yet; any other status is an actual error
        if (err?.response?.status !== 404) {
          message.error('加载基线数据失败')
        }
        form.setFieldsValue({ exam_date: dayjs() })
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [patientId, form])

  const handleSubmit = async (values) => {
    setSubmitting(true)
    try {
      const payload = {
        patient_id: parseInt(patientId, 10),
        exam_date: values.exam_date?.format('YYYY-MM-DD'),
        // Right eye
        od_sph: values.od?.sph,
        od_cyl: values.od?.cyl,
        od_axis: values.od?.axis,
        od_va: values.od?.va,
        od_al: values.od?.al,
        od_k1: values.od?.k1,
        od_k2: values.od?.k2,
        // Left eye
        os_sph: values.os?.sph,
        os_cyl: values.os?.cyl,
        os_axis: values.os?.axis,
        os_va: values.os?.va,
        os_al: values.os?.al,
        os_k1: values.os?.k1,
        os_k2: values.os?.k2,
        // Lens
        lens_brand: values.lens_brand,
        od_add: values.od_add,
        os_add: values.os_add,
      }

      if (isEdit) {
        await updateBaseline(patientId, payload)
        message.success('基线检查已更新')
      } else {
        await createBaseline(payload)
        message.success('基线检查录入成功')
      }

      navigate(`/patients/${patientId}`)
    } catch (err) {
      message.error(err?.response?.data?.detail || '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" tip="加载中…" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      {/* Page header */}
      <Space direction="vertical" size={4} style={{ marginBottom: 24 }}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/patients/${patientId}`)}
          style={{ padding: 0 }}
        >
          返回患者档案
        </Button>
        <Title level={3} style={{ margin: 0 }}>
          {isEdit ? '编辑基线检查' : '录入基线检查'}
        </Title>
        {patientName && <Text type="secondary">患者：{patientName}</Text>}
      </Space>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark="optional"
      >
        {/* 检查日期 */}
        <Card style={{ marginBottom: 16 }}>
          <Form.Item
            label="检查日期"
            name="exam_date"
            rules={[{ required: true, message: '请选择检查日期' }]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
        </Card>

        {/* 右眼 OD */}
        <Card
          title="右眼 (OD)"
          headStyle={{ color: '#1677ff' }}
          style={{ marginBottom: 16 }}
        >
          <EyeDataForm side="OD" prefix="od" form={form} includeCorneaCurvature />
        </Card>

        {/* 左眼 OS */}
        <Card
          title="左眼 (OS)"
          headStyle={{ color: '#1677ff' }}
          style={{ marginBottom: 16 }}
        >
          <EyeDataForm side="OS" prefix="os" form={form} includeCorneaCurvature />
        </Card>

        {/* 镜片信息 */}
        <Card title="镜片信息" style={{ marginBottom: 24 }}>
          <Form.Item label="镜片品牌 / 型号" name="lens_brand">
            <Input placeholder="例：欧几里德 / 梦戴维" />
          </Form.Item>

          <Divider dashed style={{ margin: '4px 0 16px' }} />

          <Form.Item label="右眼附加光度" name="od_add">
            <InputNumber
              step={0.25}
              addonAfter="D"
              style={{ width: '100%' }}
              placeholder="0.00"
            />
          </Form.Item>

          <Form.Item label="左眼附加光度" name="os_add">
            <InputNumber
              step={0.25}
              addonAfter="D"
              style={{ width: '100%' }}
              placeholder="0.00"
            />
          </Form.Item>
        </Card>

        {/* Action buttons */}
        <Space>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            size="large"
          >
            {isEdit ? '保存修改' : '提交录入'}
          </Button>
          <Button size="large" onClick={() => navigate(`/patients/${patientId}`)}>
            取消
          </Button>
        </Space>
      </Form>
    </div>
  )
}
