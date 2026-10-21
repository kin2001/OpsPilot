
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "asset_holds": {
                  Row: {
                    "asset_id": string,"created_at": string,"created_by": string,"id": string,"organization_id": string,"reason": string,"released_at": string | null,"resolution": string | null,"resolved_at": string | null,"resolved_by": string | null,"source": string,"source_id": string | null,"work_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"created_at"?: string,"created_by": string,"id"?: string,"organization_id": string,"reason": string,"released_at"?: string | null,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source": string,"source_id"?: string | null,"work_order_id"?: string | null
                  }
                  Update: {
                    "asset_id"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"organization_id"?: string,"reason"?: string,"released_at"?: string | null,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source"?: string,"source_id"?: string | null,"work_order_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_holds_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "asset_holds_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"asset_meter_readings": {
                  Row: {
                    "asset_id": string,"correction_of": string | null,"correction_reason": string | null,"id": string,"kind": string,"observed_at": string,"organization_id": string,"recorded_at": string,"recorded_by": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"correction_of"?: string | null,"correction_reason"?: string | null,"id"?: string,"kind": string,"observed_at": string,"organization_id": string,"recorded_at"?: string,"recorded_by": string,"value": number
                  }
                  Update: {
                    "asset_id"?: string,"correction_of"?: string | null,"correction_reason"?: string | null,"id"?: string,"kind"?: string,"observed_at"?: string,"organization_id"?: string,"recorded_at"?: string,"recorded_by"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_meter_readings_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "asset_meter_readings_organization_id_correction_of_fkey"
      columns: ["organization_id","correction_of"]
isOneToOne: false
      referencedRelation: "asset_meter_readings"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"asset_releases": {
                  Row: {
                    "acknowledgment": string,"actor_id": string,"asset_id": string,"checked_version": number,"created_at": string,"hold_ids": (string)[],"id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledgment": string,"actor_id": string,"asset_id": string,"checked_version": number,"created_at"?: string,"hold_ids": (string)[],"id"?: string,"organization_id": string
                  }
                  Update: {
                    "acknowledgment"?: string,"actor_id"?: string,"asset_id"?: string,"checked_version"?: number,"created_at"?: string,"hold_ids"?: (string)[],"id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_releases_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"assets": {
                  Row: {
                    "archived_at": string | null,"availability": string,"category": string,"code": string,"created_at": string,"created_by": string,"id": string,"name": string,"organization_id": string,"registration": string | null,"serial_number": string | null,"site_id": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"availability"?: string,"category": string,"code": string,"created_at"?: string,"created_by": string,"id"?: string,"name": string,"organization_id": string,"registration"?: string | null,"serial_number"?: string | null,"site_id"?: string | null,"version"?: number
                  }
                  Update: {
                    "archived_at"?: string | null,"availability"?: string,"category"?: string,"code"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"registration"?: string | null,"serial_number"?: string | null,"site_id"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "assets_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assets_organization_id_site_id_fkey"
      columns: ["organization_id","site_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"attachments": {
                  Row: {
                    "asset_id": string | null,"checksum": string | null,"cleanup_completed_at": string | null,"created_at": string,"height": number | null,"id": string,"media_type": string,"name": string,"object_key": string,"organization_id": string,"ready_at": string | null,"request_id": string | null,"size": number,"status": string,"uploader_id": string,"width": number | null,"work_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"checksum"?: string | null,"cleanup_completed_at"?: string | null,"created_at"?: string,"height"?: number | null,"id"?: string,"media_type": string,"name": string,"object_key": string,"organization_id": string,"ready_at"?: string | null,"request_id"?: string | null,"size": number,"status"?: string,"uploader_id": string,"width"?: number | null,"work_order_id"?: string | null
                  }
                  Update: {
                    "asset_id"?: string | null,"checksum"?: string | null,"cleanup_completed_at"?: string | null,"created_at"?: string,"height"?: number | null,"id"?: string,"media_type"?: string,"name"?: string,"object_key"?: string,"organization_id"?: string,"ready_at"?: string | null,"request_id"?: string | null,"size"?: number,"status"?: string,"uploader_id"?: string,"width"?: number | null,"work_order_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "attachments_organization_id_request_id_fkey"
      columns: ["organization_id","request_id"]
isOneToOne: false
      referencedRelation: "maintenance_requests"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "attachments_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string,"changes": NonNullable<Json>,"created_at": string,"entity_id": string,"id": string,"organization_id": string | null,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"changes": NonNullable<Json>,"created_at"?: string,"entity_id": string,"id"?: string,"organization_id"?: string | null,"request_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"changes"?: NonNullable<Json>,"created_at"?: string,"entity_id"?: string,"id"?: string,"organization_id"?: string | null,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_requests": {
                  Row: {
                    "asset_id": string,"category": string,"converted_work_order_id": string | null,"created_at": string,"description": string,"id": string,"organization_id": string,"reporter_id": string,"status": string,"transition_reason": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"category": string,"converted_work_order_id"?: string | null,"created_at"?: string,"description": string,"id"?: string,"organization_id": string,"reporter_id": string,"status"?: string,"transition_reason"?: string | null,"version"?: number
                  }
                  Update: {
                    "asset_id"?: string,"category"?: string,"converted_work_order_id"?: string | null,"created_at"?: string,"description"?: string,"id"?: string,"organization_id"?: string,"reporter_id"?: string,"status"?: string,"transition_reason"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_requests_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "maintenance_requests_organization_id_converted_work_order__fkey"
      columns: ["organization_id","converted_work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "maintenance_requests_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "category": string,"created_at": string,"event_id": string,"id": string,"organization_id": string,"read_at": string | null,"recipient_user_id": string,"source_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"event_id": string,"id"?: string,"organization_id": string,"read_at"?: string | null,"recipient_user_id": string,"source_id": string
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"event_id"?: string,"id"?: string,"organization_id"?: string,"read_at"?: string | null,"recipient_user_id"?: string,"source_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_organization_id_recipient_user_id_fkey"
      columns: ["organization_id","recipient_user_id"]
isOneToOne: false
      referencedRelation: "organization_members"
      referencedColumns: ["organization_id","user_id"]
    }
                  ]
                },"organization_invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"inviter_id": string,"organization_id": string,"revoked_at": string | null,"role": string,"token_hash": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"inviter_id": string,"organization_id": string,"revoked_at"?: string | null,"role": string,"token_hash": string,"version"?: number
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"inviter_id"?: string,"organization_id"?: string,"revoked_at"?: string | null,"role"?: string,"token_hash"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "active": boolean,"created_at": string,"organization_id": string,"role": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"organization_id": string,"role": string,"user_id": string,"version"?: number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"organization_id"?: string,"role"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_settings": {
                  Row: {
                    "ai_enabled": boolean,"evidence_required": boolean,"organization_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_enabled"?: boolean,"evidence_required"?: boolean,"organization_id": string,"version"?: number
                  }
                  Update: {
                    "ai_enabled"?: boolean,"evidence_required"?: boolean,"organization_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string,"currency": string,"id": string,"name": string,"timezone": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"currency": string,"id"?: string,"name": string,"timezone": string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"currency"?: string,"id"?: string,"name"?: string,"timezone"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"request_events": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"id": string,"organization_id": string,"reason": string | null,"request_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"created_at"?: string,"id"?: string,"organization_id": string,"reason"?: string | null,"request_id": string,"status": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"id"?: string,"organization_id"?: string,"reason"?: string | null,"request_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "request_events_organization_id_request_id_fkey"
      columns: ["organization_id","request_id"]
isOneToOne: false
      referencedRelation: "maintenance_requests"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"sites": {
                  Row: {
                    "id": string,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"organization_id": string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sites_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"work_order_assignments": {
                  Row: {
                    "assigned_at": string,"id": string,"organization_id": string,"unassigned_at": string | null,"user_id": string,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"id"?: string,"organization_id": string,"unassigned_at"?: string | null,"user_id": string,"work_order_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"id"?: string,"organization_id"?: string,"unassigned_at"?: string | null,"user_id"?: string,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_assignments_organization_id_user_id_fkey"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_members"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "work_order_assignments_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"work_order_events": {
                  Row: {
                    "action": string,"actor_id": string,"changes": NonNullable<Json>,"created_at": string,"id": string,"labor_minutes": number | null,"note": string | null,"organization_id": string,"repair_revision": number,"request_id": string,"status": string,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"changes"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"labor_minutes"?: number | null,"note"?: string | null,"organization_id": string,"repair_revision": number,"request_id": string,"status": string,"work_order_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"changes"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"labor_minutes"?: number | null,"note"?: string | null,"organization_id"?: string,"repair_revision"?: number,"request_id"?: string,"status"?: string,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_events_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"work_order_participants": {
                  Row: {
                    "organization_id": string,"recorded_at": string,"source": string,"user_id": string,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "organization_id": string,"recorded_at"?: string,"source": string,"user_id": string,"work_order_id": string
                  }
                  Update: {
                    "organization_id"?: string,"recorded_at"?: string,"source"?: string,"user_id"?: string,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_participants_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"work_order_reviews": {
                  Row: {
                    "created_at": string,"decision": string,"id": string,"organization_id": string,"reason": string,"repair_revision": number,"reviewer_id": string,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decision": string,"id"?: string,"organization_id": string,"reason": string,"repair_revision": number,"reviewer_id": string,"work_order_id": string
                  }
                  Update: {
                    "created_at"?: string,"decision"?: string,"id"?: string,"organization_id"?: string,"reason"?: string,"repair_revision"?: number,"reviewer_id"?: string,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_reviews_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"work_order_tasks": {
                  Row: {
                    "completed": boolean,"completed_at": string | null,"completed_by": string | null,"id": string,"label": string,"organization_id": string,"required": boolean,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed"?: boolean,"completed_at"?: string | null,"completed_by"?: string | null,"id"?: string,"label": string,"organization_id": string,"required"?: boolean,"work_order_id": string
                  }
                  Update: {
                    "completed"?: boolean,"completed_at"?: string | null,"completed_by"?: string | null,"id"?: string,"label"?: string,"organization_id"?: string,"required"?: boolean,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_tasks_organization_id_work_order_id_fkey"
      columns: ["organization_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"work_orders": {
                  Row: {
                    "asset_id": string,"blocks_operation": boolean,"category": string,"completed_at": string | null,"created_at": string,"created_by": string,"description": string,"due_at": string | null,"id": string,"number": number,"opened_at": string | null,"organization_id": string,"priority": string,"priority_reason": string | null,"repair_revision": number,"source_request_id": string | null,"status": string,"submitted_revision": number | null,"supervisor_id": string,"title": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"blocks_operation"?: boolean,"category": string,"completed_at"?: string | null,"created_at"?: string,"created_by": string,"description": string,"due_at"?: string | null,"id"?: string,"number": number,"opened_at"?: string | null,"organization_id": string,"priority": string,"priority_reason"?: string | null,"repair_revision"?: number,"source_request_id"?: string | null,"status"?: string,"submitted_revision"?: number | null,"supervisor_id": string,"title": string,"version"?: number
                  }
                  Update: {
                    "asset_id"?: string,"blocks_operation"?: boolean,"category"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string,"due_at"?: string | null,"id"?: string,"number"?: number,"opened_at"?: string | null,"organization_id"?: string,"priority"?: string,"priority_reason"?: string | null,"repair_revision"?: number,"source_request_id"?: string | null,"status"?: string,"submitted_revision"?: number | null,"supervisor_id"?: string,"title"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_orders_organization_id_asset_id_fkey"
      columns: ["organization_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "work_orders_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_orders_organization_id_source_request_id_fkey"
      columns: ["organization_id","source_request_id"]
isOneToOne: true
      referencedRelation: "maintenance_requests"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_organization_invitation":
{ Args: { "request_id": string,"token": string }; Returns: Json
                           },
"add_work_order_task":
{ Args: { "ctx": Json,"id": string,"label": string,"required"?: boolean }; Returns: Json
                           },
"assign_work_order":
{ Args: { "ctx": Json,"id": string,"user_ids": (string)[] }; Returns: Json
                           },
"attachment_access":
{ Args: { "attachment_id": string,"organization_id": string }; Returns: Json
                           },
"attachment_cleanup_batch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"attachment_cleanup_done":
{ Args: { "attachment_id": string }; Returns: undefined
                           },
"convert_request":
{ Args: { "ctx": Json,"id": string,"work_order_fields": Json }; Returns: Json
                           },
"correct_meter_reading":
{ Args: { "ctx": Json,"id": string,"reason": string,"value": number }; Returns: Json
                           },
"create_organization":
{ Args: { "currency": string,"name": string,"request_id": string,"timezone": string }; Returns: Json
                           },
"create_organization_invitation":
{ Args: { "ctx": Json,"email": string,"role": string }; Returns: Json
                           },
"create_work_order":
{ Args: { "asset_id": string,"ctx": Json,"fields": Json }; Returns: Json
                           },
"finalize_attachment":
{ Args: { "actor_id": string,"attachment_id": string,"checksum": string,"height": number,"organization_id": string,"width": number }; Returns: Json
                           },
"get_dashboard":
{ Args: { "organization_id": string,"range": Json }; Returns: Json
                           },
"get_team":
{ Args: { "organization_id": string }; Returns: Json
                           },
"lookup_request_asset":
{ Args: { "asset_code"?: string,"asset_id"?: string,"organization_id": string }; Returns: {
              "code": string,"id": string,"name": string
            }[]
                           },
"mark_notifications_read":
{ Args: { "ctx": Json,"ids": (string)[] }; Returns: Json
                           },
"record_meter_reading":
{ Args: { "asset_id": string,"ctx": Json,"kind": string,"observed_at": string,"value": number }; Returns: Json
                           },
"release_asset":
{ Args: { "acknowledgment": string,"asset_id": string,"ctx": Json }; Returns: Json
                           },
"reserve_attachment":
{ Args: { "ctx": Json,"id": string,"media_type": string,"name": string,"size": number }; Returns: Json
                           },
"reserve_record_attachment":
{ Args: { "ctx": Json,"media_type": string,"name": string,"parent_id": string,"parent_type": string,"size": number }; Returns: Json
                           },
"resolve_asset_hold":
{ Args: { "ctx": Json,"disposition": string,"hold_id": string,"reason": string }; Returns: Json
                           },
"review_work_order":
{ Args: { "ctx": Json,"decision": string,"id": string,"reason": string }; Returns: Json
                           },
"revoke_organization_invitation":
{ Args: { "ctx": Json,"invitation_id": string }; Returns: Json
                           },
"save_asset":
{ Args: { "asset_id": string,"ctx": Json,"fields": Json }; Returns: Json
                           },
"save_organization_settings":
{ Args: { "ctx": Json,"fields": Json }; Returns: Json
                           },
"save_request":
{ Args: { "asset_id": string,"category": string,"ctx": Json,"description": string,"id": string }; Returns: Json
                           },
"set_asset_hold":
{ Args: { "asset_id": string,"ctx": Json,"reason": string }; Returns: Json
                           },
"set_organization_member":
{ Args: { "active": boolean,"ctx": Json,"role": string,"user_id": string }; Returns: Json
                           },
"submit_request":
{ Args: { "ctx": Json,"id": string }; Returns: Json
                           },
"transfer_organization_ownership":
{ Args: { "ctx": Json,"new_owner_id": string }; Returns: Json
                           },
"transition_work_order":
{ Args: { "ctx": Json,"id": string,"reason"?: string,"target": string }; Returns: Json
                           },
"triage_request":
{ Args: { "ctx": Json,"decision": string,"id": string,"reason": string }; Returns: Json
                           },
"update_work_order":
{ Args: { "allowed_fields": Json,"ctx": Json,"id": string }; Returns: Json
                           },
"withdraw_request":
{ Args: { "ctx": Json,"id": string,"reason": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
