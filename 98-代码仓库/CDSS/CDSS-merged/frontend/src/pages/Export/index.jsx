import { useState, useEffect } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Select,
  Space,
  Typography,
  Alert,
  message,
} from 'antd'
import { DownloadOutlined, InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/client'
import { listCenters } from '../../api/centers'
import { useAuth } from '../../contexts/AuthContext'

const { Title, Paragraph, Text } = Typography
const { RangePicker } = DatePicker

export default function ExportPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [form] = Form.useForm()
  const [downloading, setDownloading] = useState(false)
  const [centers, setCenters] = useState([])

  // Load center options for admin users
  useEffect(() => {
    if (!isAdmin) return
    listCenters()
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : res.data?.items ?? []
        setCenters(data)
      })
      .catch(() => {
        // Non-fatal: admin can still export without center filter
      })
  }, [isAdmin])

  const handleExport = async (values) => {
    setDownloading(true)
    try {
      const params = {}

      if (values.date_range?.length === 2) {
        params.start_date = values.date_range[0].format('YYYY-MM-DD')
        params.end_date = values.date_range[1].format('YYYY-MM-DD')
      }

      if (isAdmin && values.center_id) {
        params.center_id = values.center_id
      }

      const response = await api.get('/export/csv', {
        params,
        responseType: 'blob',
      })

      const date = dayjs().format('YYYYMMDD')
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `myopia_data_${date}.csv`
      a.click()
      URL.revokeObjectURL(url)

      message.success('导出成功')
    } catch (err) {
      message.error(
        err?.response?.status === 403
          ? '权限不足，无法导出数据'
          : '导出失败，请稍后重试'
      )
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <Title level={3} style={{ marginBottom: 4 }}>
        数据导出
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        导出全量患者数据（宽表格式），包含基线检查及所有随访记录，可直接用于统计分析。
      </Paragraph>

      {/* Field description card */}
      <Card
        style={{ marginBottom: 20, background: '#f6f8ff', borderColor: '#d0e4ff' }}
      >
        <Space align="start">
          <InfoCircleOutlined style={{ color: '#1677ff', marginTop: 3 }} />
          <div>
            <Text strong>导出字段说明</Text>
            <Paragraph style={{ margin: '6px 0 0', color: '#555' }}>
              导出字段包含：患者基本信息 + 家庭因素 + 基线双眼检查（含角膜曲率）+
              1M / 3M / 6M / 12M 随访记录
            </Paragraph>
          </div>
        </Space>
      </Card>

      {/* Filter form */}
      <Card title="筛选条件" style={{ marginBottom: 24 }}>
        <Form form={form} layout="vertical" onFinish={handleExport}>
          <Form.Item label="入组时间范围" name="date_range">
            <RangePicker
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
              placeholder={['开始日期', '结束日期']}
              allowEmpty={[true, true]}
            />
          </Form.Item>

          {isAdmin && (
            <Form.Item label="所属中心" name="center_id">
              <Select
                placeholder="全部中心"
                allowClear
                options={centers.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </Form.Item>
          )}

          {!isAdmin && user?.center_id && (
            <Alert
              type="info"
              showIcon
              message={`导出范围：本中心数据（中心 ID：${user.center_id}）`}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              size="large"
              htmlType="submit"
              icon={<DownloadOutlined />}
              loading={downloading}
              style={{ minWidth: 160 }}
            >
              {downloading ? '正在导出…' : '导出 CSV'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
