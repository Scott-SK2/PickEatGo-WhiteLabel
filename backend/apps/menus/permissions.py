from rest_framework import permissions

class IsRestaurantOwnerOrAdmin(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        restaurant = getattr(obj, "restaurant", None) or obj.category.restaurant
        return restaurant.owner == request.user or request.user.is_admin_user
