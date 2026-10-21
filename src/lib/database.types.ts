
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "assets": {
                  Row: {
                    "archived_at": string | null,"category": string,"code": string,"created_at": string,"created_by": string,"id": string,"name": string,"organization_id": string,"registration": string | null,"serial_number": string | null,"site_id": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"category": string,"code": string,"created_at"?: string,"created_by": string,"id"?: string,"name": string,"organization_id": string,"registration"?: string | null,"serial_number"?: string | null,"site_id"?: string | null,"version"?: number
                  }
                  Update: {
                    "archived_at"?: string | null,"category"?: string,"code"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"registration"?: string | null,"serial_number"?: string | null,"site_id"?: string | null,"version"?: number
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
                },"work_orders": {
                  Row: {
                    "asset_id": string,"blocks_operation": boolean,"category": string,"created_at": string,"created_by": string,"description": string,"due_at": string | null,"id": string,"number": number,"organization_id": string,"priority": string,"source_request_id": string | null,"status": string,"supervisor_id": string,"title": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id": string,"blocks_operation"?: boolean,"category": string,"created_at"?: string,"created_by": string,"description": string,"due_at"?: string | null,"id"?: string,"number": number,"organization_id": string,"priority": string,"source_request_id"?: string | null,"status"?: string,"supervisor_id": string,"title": string,"version"?: number
                  }
                  Update: {
                    "asset_id"?: string,"blocks_operation"?: boolean,"category"?: string,"created_at"?: string,"created_by"?: string,"description"?: string,"due_at"?: string | null,"id"?: string,"number"?: number,"organization_id"?: string,"priority"?: string,"source_request_id"?: string | null,"status"?: string,"supervisor_id"?: string,"title"?: string,"version"?: number
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
"assign_work_order":
{ Args: { "ctx": Json,"id": string,"user_ids": (string)[] }; Returns: Json
                           },
"convert_request":
{ Args: { "ctx": Json,"id": string,"work_order_fields": Json }; Returns: Json
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
"lookup_request_asset":
{ Args: { "asset_code"?: string,"asset_id"?: string,"organization_id": string }; Returns: {
              "code": string,"id": string,"name": string
            }[]
                           },
"revoke_organization_invitation":
{ Args: { "ctx": Json,"invitation_id": string }; Returns: Json
                           },
"save_asset":
{ Args: { "asset_id": string,"ctx": Json,"fields": Json }; Returns: Json
                           },
"save_request":
{ Args: { "asset_id": string,"category": string,"ctx": Json,"description": string,"id": string }; Returns: Json
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
"triage_request":
{ Args: { "ctx": Json,"decision": string,"id": string,"reason": string }; Returns: Json
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
