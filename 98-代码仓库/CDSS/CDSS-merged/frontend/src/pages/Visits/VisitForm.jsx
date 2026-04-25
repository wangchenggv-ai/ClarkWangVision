import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Form,
  DatePicker,
  Select,
  Switch,
  InputNumber,
  Input,
  Button,
  Card,
  Typography,
  Space,
  message,
  Spin,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { listVisits, createVisit, updateVisit } from '../../api/visits'
import EyeDataForm from '../../components/EyeDataForm'

const { Title, Text } = Typography
const { TextArea } = Input

const VISIT_TYPE_OPTIONS = [
  { value: '1M', label: '1 个月' },
  { value: '3M', label: '3 个月' },
  { value: '6M', label: '6 个月' },
  { value: '12M', label: '12 个月' },
  { value: 'other', label: '其他' },
]

export default function VisitForm() {
  const { patientId } = useParams()
  const [searchParams] = useSearchParams()
  const visitId = searchParams.get('visitId')
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const [loading, setLoading] = useState(!!visitId)
  const [submitting, setSubmitting] = useState(false)
  const isEdit = Boolean(visitId)

  useEffect(() => {
    if (!visitId) {
      form.setFieldsValue({ visit_date: dayjs() })
      return
    }

    async function loadVisit() {
      setLoading(true)
      try {
        // Fetch all visits for this patient and find the matching one
        const res = await listVisits(patientId)
        const visits = Array.isArray(res.data) ? res.data : res.data?.items ?? []
        const visit = visits.find((v) => String(v.id) === String(visitId))

        if (!visit) {
          message.error('未找到该随访记录')
          navigate(`/patients/${patientId}`)
          return
        }

        form.setFieldsValue({
          visit_type: visit.visit_type,
          visit_date: visit.visit_date ? dayjs(visit.visit_date) : dayjs(),
          od: {
            sph: visit.od_sph,
            cyl: visit.od_cyl,
            axis: visit.od_axis,
            va: visit.od_va,
            al: visit.od_al,
          },
          os: {
            sph: visit.os_sph,
            cyl: visit.os_cyl,
            axis: visit.os_axis,
            va: visit.os_va,
            al: visit.os_al,
          },
          wearing_hours: visit.wearing_hours,
          compliance_good: visit.compliance_good ?? true,
          chief_complaint: visit.chief_complaint,
          examiner_notes: visit.examiner_notes,
        })
      } catch {
        message.error('加载随访数据失败')
      } finally {
        setLoading(false)
      }
    }

    loadVisit()
  }, [visitId, patientId, form, navigate])

  const handleSubmit = async (values) => {
    setSubmitting(true)
    try {
      const payload = {
        patient_id: parseInt(patientId, 10),
        visit_type: values.visit_type,
        visit_date: values.visit_date?.format('YYYY-MM-DD'),
        // Right eye
        od_sph: values.od?.sph,
        od_cyl: values.od?.cyl,
        od_axis: values.od?.axis,
        od_va: values.od?.va,
        od_al: values.od?.al,
        // Left eye
        os_sph: values.os?.sph,
        os_cyl: values.os?.cyl,
        os_axis: values.os?.axis,
        os_va: values.os?.va,
        os_al: values.os?.al,
        // Wearing info
        wearing_hours: values.wearing_hours,
        compliance_good: values.compliance_good,
        chief_complaint: values.chief_complaint,
        examiner_notes: values.examiner_notes,
      }

      if (isEdit) {
        await updateVisit(visitId, payload)
        message.success('随访记录已更新')
      } else {
        await createVisit(payload)
        message.success('随访记录已创建')
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
          {isEdit ? '编辑随访记录' : '新建随访记录'}
        </Title>
        <Text type="secondary">患者 ID：{patientId}</Text>
      </Space>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark="optional"
        initialValues={{ compliance_good: true }}
      >
        {/* 随访基本信息 */}
        <Card style={{ marginBottom: 16 }}>
          <Form.Item
            label="随访类型"
            name="visit_type"
            rules={[{ required: true, message: '请选择随访类型' }]}
          >
            <Select placeholder="请选择随访类型" options={VISIT_TYPE_OPTIONS} />
          </Form.Item>

          <Form.Item
            label="随访日期"
            name="visit_date"
            rules={[{ required: true, message: '请选择随访日期' }]}
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
          <EyeDataForm side="OD" prefix="od" form={form} />
        </Card>

        {/* 左眼 OS */}
        <Card
          title="左眼 (OS)"
          headStyle={{ color: '#1677ff' }}
          style={{ marginBottom: 16 }}
        >
          <EyeDataForm side="OS" prefix="os" form={form} />
        </Card>

        {/* 佩戴情况 */}
        <Card title="佩戴情况" style={{ marginBottom: 16 }}>
          <Form.Item label="日均佩戴时间（小时）" name="wearing_hours">
            <InputNumber
              min={0}
              max={24}
              style={{ width: '100%' }}
              placeholder="8"
              addonAfter="小时"
            />
          </Form.Item>

          <Form.Item
            label="佩戴依从性"
            name="compliance_good"
            valuePropName="checked"
          >
            <Switch checkedChildren="依从性良好" unCheckedChildren="依从性不佳" />
          </Form.Item>
        </Card>

        {/* 主诉与备注 */}
        <Card title="主诉与备注" style={{ marginBottom: 24 }}>
          <Form.Item label="患者主诉" name="chief_complaint">
            <TextArea
              rows={3}
              placeholder="患者本次就诊的主要诉求或症状描述（可选）"
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item label="检查者备注" name="examiner_notes">
            <TextArea
              rows={3}
              placeholder="检查者观察记录、医嘱或注意事项（可选）"
              maxLength={500}
              showCount
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
            {isEdit ? '保存修改' : '提交记录'}
          </Button>
          <Button size="large" onClick={() => navigate(`/patients/${patientId}`)}>
            取消
          </Button>
        </Space>
      </Form>
    </div>
  )
}
